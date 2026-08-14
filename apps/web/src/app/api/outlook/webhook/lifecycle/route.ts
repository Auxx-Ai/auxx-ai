// apps/web/src/app/api/outlook/webhook/lifecycle/route.ts

import { database as db, schema } from '@auxx/database'
import { enqueueOutlookPushSync } from '@auxx/lib/jobs'
import { getQueue, Queues } from '@auxx/lib/jobs/queues'
import { createScopedLogger } from '@auxx/logger'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  getStoredClientState,
  resolveIntegrationBySubscriptionId,
  validationResponse,
  verifyClientState,
} from '../shared'

const logger = createScopedLogger('outlook-webhook-lifecycle')

/**
 * Microsoft Graph *lifecycle*-notification endpoint for Outlook mail subscriptions — a separate
 * URL from the change-notification route because `lifecycleNotificationUrl` and `notificationUrl`
 * are independently configured (and independently handshake-validated) on the subscription.
 *
 * Handles the three lifecycle events Outlook `message` subscriptions support (plan §2.2):
 *
 * - `reauthorizationRequired` — enqueue `webhookRenewalJob`: a `PATCH` with a fresh
 *   `expirationDateTime` reauthorizes **and** renews in one call. Never pair this with
 *   `POST /subscriptions/{id}/reauthorize` — Graph warns that causes subscription state
 *   inconsistency.
 * - `subscriptionRemoved` — clear the stored subscription state, enqueue a re-arm
 *   (`webhookRenewalJob` recreates it), and enqueue one `outlookPushSyncJob` to catch
 *   whatever mail was missed while the subscription was gone.
 * - `missed` — enqueue `outlookPushSyncJob`: notifications were dropped Graph-side, so a
 *   full delta resync is the only way to catch up.
 *
 * Same 3-second-ack discipline as the main route: validate + verify + enqueue only, `202`
 * immediately after — never sync inline.
 */

interface GraphLifecycleNotification {
  subscriptionId: string
  clientState?: string
  lifecycleEvent: 'reauthorizationRequired' | 'subscriptionRemoved' | 'missed'
  subscriptionExpirationDateTime?: string
  resource?: string
  tenantId?: string
}

interface GraphLifecyclePayload {
  value: GraphLifecycleNotification[]
}

/**
 * GET handler - health check, plus the validation handshake for good measure.
 *
 * Graph itself validates over POST (see the POST handler); this branch only
 * covers manual pokes at the endpoint.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const validationToken = new URL(req.url).searchParams.get('validationToken')
  if (validationToken) return validationResponse(validationToken)

  return NextResponse.json({ status: 'ok', timestamp: Date.now() })
}

/**
 * POST handler - subscription validation, then lifecycle events.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Must be answered before any body read — see the main route's identical comment.
  const validationToken = new URL(req.url).searchParams.get('validationToken')
  if (validationToken) return validationResponse(validationToken)

  logger.info('Received Microsoft Graph lifecycle notification')

  let body: GraphLifecyclePayload
  try {
    body = await req.json()
  } catch (error) {
    logger.error('Could not parse Microsoft Graph lifecycle body as JSON', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
  }

  if (!body || !body.value || !Array.isArray(body.value)) {
    logger.error('Invalid Microsoft Graph lifecycle payload format', { body })
    return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
  }

  try {
    for (const notification of body.value) {
      await processLifecycleNotification(notification)
    }
  } catch (error) {
    // Processing here is only lookups + enqueues — a throw means one of those didn't durably
    // happen, so 5xx to let Graph retry rather than silently dropping the event.
    logger.error('Error processing Microsoft Graph lifecycle notification', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error processing webhook' }, { status: 500 })
  }

  return NextResponse.json({ success: true, processed: body.value.length }, { status: 202 })
}

async function processLifecycleNotification(
  notification: GraphLifecycleNotification
): Promise<void> {
  const integration = await resolveIntegrationBySubscriptionId(notification.subscriptionId)
  if (!integration) {
    logger.warn('No active Outlook integration found for lifecycle subscription ID', {
      subscriptionId: notification.subscriptionId,
      lifecycleEvent: notification.lifecycleEvent,
    })
    return
  }

  const storedClientState = getStoredClientState(integration.metadata)
  if (!storedClientState || !verifyClientState(notification, storedClientState)) {
    logger.error('Client state verification failed — dropping lifecycle notification', {
      integrationId: integration.id,
      subscriptionId: notification.subscriptionId,
      lifecycleEvent: notification.lifecycleEvent,
    })
    return
  }

  const { id: integrationId, organizationId } = integration

  switch (notification.lifecycleEvent) {
    case 'reauthorizationRequired':
      await enqueueWebhookRenewal(integrationId, organizationId)
      break

    case 'subscriptionRemoved':
      await clearStoredSubscription(integrationId)
      await enqueueWebhookRenewal(integrationId, organizationId)
      await enqueueOutlookPushSync({ integrationId, organizationId })
      break

    case 'missed':
      await enqueueOutlookPushSync({ integrationId, organizationId })
      break

    default:
      logger.warn('Unknown Microsoft Graph lifecycle event', {
        integrationId,
        lifecycleEvent: notification.lifecycleEvent,
      })
  }
}

/**
 * Enqueue the existing renewal job — same shape/jobId as the renewal scanner
 * (`webhook-renewal-scanner-job.ts`) so the two producers dedupe against each other.
 */
async function enqueueWebhookRenewal(integrationId: string, organizationId: string): Promise<void> {
  const maintenanceQueue = getQueue(Queues.maintenanceQueue)

  try {
    await maintenanceQueue.add(
      'webhookRenewalJob',
      { integrationId, organizationId, provider: 'outlook' },
      {
        jobId: `webhook-renewal-${integrationId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      }
    )
  } catch (error: any) {
    if (error.message?.includes('Job already exists')) return
    throw error
  }
}

/**
 * Clear the removed subscription's state so the next arm starts clean. `webhookRouteKey` must be
 * nulled explicitly here — once the subscription id lives in that column (plan §3.4), wiping
 * `metadata` alone no longer clears it.
 */
async function clearStoredSubscription(integrationId: string): Promise<void> {
  await db
    .update(schema.Integration)
    .set({
      webhookRouteKey: null,
      metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb)
        - 'outlookSubscription' - 'graphSubscriptionId'
        - 'webhookSecret' - 'subscriptionExpiration'`,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, integrationId))
}
