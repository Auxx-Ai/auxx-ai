// apps/web/src/app/api/outlook/webhook/route.ts

import { enqueueOutlookPushSync } from '@auxx/lib/jobs'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type GraphWebhookNotification,
  type GraphWebhookPayload,
  getStoredClientState,
  resolveIntegrationBySubscriptionId,
  validationResponse,
  verifyClientState,
} from './shared'

const logger = createScopedLogger('outlook-webhook')

/**
 * Microsoft Graph change-notification endpoint for Outlook mail. Shape: validate → enqueue →
 * `202 Accepted`, all inside Graph's 3-second ack window (plan §2.3) — anything slower and the
 * endpoint gets marked slow/drop and mail is silently lost. The actual delta walk + ingest runs
 * out-of-band in `outlookPushSyncJob` on the message-sync queue; this route never syncs inline.
 */

/**
 * GET handler - health check, plus the validation handshake for good measure.
 *
 * Graph itself validates over POST (see the POST handler); this branch only
 * covers manual pokes at the endpoint.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const validationToken = new URL(req.url).searchParams.get('validationToken')
  if (validationToken) return validationResponse(validationToken)

  // Health check if no validation token
  return NextResponse.json({ status: 'ok', timestamp: Date.now() })
}

/**
 * POST handler - subscription validation, then change notifications.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Graph performs the notificationUrl handshake as a POST carrying
  // `?validationToken=` and an EMPTY body. This must be answered before any
  // attempt to read the body — `req.json()` on an empty body throws, which used
  // to surface as a 500 and made every subscription create/renew fail.
  const validationToken = new URL(req.url).searchParams.get('validationToken')
  if (validationToken) return validationResponse(validationToken)

  logger.info('Received Microsoft Graph webhook notification')

  let body: GraphWebhookPayload
  try {
    body = await req.json()
  } catch (error) {
    // Malformed body is the sender's bug — 400 so Graph stops retrying it.
    logger.error('Could not parse Microsoft Graph webhook body as JSON', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
  }

  if (!body || !body.value || !Array.isArray(body.value)) {
    logger.error('Invalid Microsoft Graph webhook payload format', { body })
    return NextResponse.json({ error: 'Invalid payload format' }, { status: 400 })
  }

  // One DB lookup per subscription, not per notification (plan §3.4/Phase 3.4) — a busy mailbox
  // can send several notifications in one batch, all sharing the same subscriptionId.
  const bySubscriptionId = new Map<string, GraphWebhookNotification[]>()
  for (const notification of body.value) {
    const group = bySubscriptionId.get(notification.subscriptionId) ?? []
    group.push(notification)
    bySubscriptionId.set(notification.subscriptionId, group)
  }

  let dropped = 0

  try {
    for (const [subscriptionId, notifications] of bySubscriptionId) {
      const integration = await resolveIntegrationBySubscriptionId(subscriptionId)
      if (!integration) {
        logger.warn('No active Outlook integration found for subscription ID', {
          subscriptionId,
        })
        dropped += notifications.length
        continue
      }

      const storedClientState = getStoredClientState(integration.metadata)
      if (!storedClientState) {
        logger.error('No stored clientState — rejecting notifications; channel needs re-arming', {
          integrationId: integration.id,
          subscriptionId,
        })
        dropped += notifications.length
        continue
      }

      const verified = notifications.filter((notification) => {
        const ok = verifyClientState(notification, storedClientState)
        if (!ok) {
          logger.error('Client state verification failed — dropping notification', {
            integrationId: integration.id,
            subscriptionId,
          })
        }
        return ok
      })
      dropped += notifications.length - verified.length

      const hasSyncTrigger = verified.some(
        (notification) =>
          notification.changeType === 'created' || notification.changeType === 'updated'
      )
      if (hasSyncTrigger) {
        // Once per integration — the jobId's debounce window dedupes anything finer.
        await enqueueOutlookPushSync({
          integrationId: integration.id,
          organizationId: integration.organizationId,
        })
      }
    }
  } catch (error) {
    // An enqueue failing means work was NOT durably queued — 5xx so Graph retries the whole
    // batch, rather than acknowledging notifications we never acted on (plan §2.3/Phase 3.3).
    logger.error('Error enqueuing Outlook push sync from webhook notification', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Internal server error processing webhook' }, { status: 500 })
  }

  // Dropped/skipped notifications are still counted as processed-and-acknowledged — they must
  // NOT cause Graph to retry a notification we will never accept.
  return NextResponse.json(
    { success: true, processed: body.value.length, dropped },
    { status: 202 }
  )
}
