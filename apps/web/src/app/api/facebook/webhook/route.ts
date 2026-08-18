// apps/web/src/app/api/facebook/webhook/route.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { MessageStorageService } from '@auxx/lib/email'
import { resolveSocialCounterpartName } from '@auxx/lib/providers/social/profile'
import type {
  MetaWebhookEnvelope,
  MetaWebhookMessagingEvent,
  SocialIntegrationMetadata,
} from '@auxx/lib/providers/social/types'
import { convertMetaWebhookEventToMessageData } from '@auxx/lib/providers/social/webhook-message'
import { metaPreset, verifyWebhook } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { after, type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('facebook-webhook')

/**
 * Handles Facebook webhook verification (GET request).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  logger.info('Received Facebook webhook verification request', { mode, token })
  if (mode && token) {
    if (
      mode === 'subscribe' &&
      token === configService.get<string>('FACEBOOK_WEBHOOK_VERIFY_TOKEN')
    ) {
      logger.info('Facebook webhook verification successful.')
      return new NextResponse(challenge, { status: 200 })
    }
    logger.warn('Facebook webhook verification failed: Invalid mode or token.')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  logger.warn('Facebook webhook verification failed: Missing mode or token.')
  return NextResponse.json({ error: 'Bad Request' }, { status: 400 })
}

/**
 * Handles incoming Facebook webhook events (POST request).
 *
 * Verify → parse → resolve Integration → convert → store. The conversion itself
 * lives in `@auxx/lib/providers/social/webhook-message` so the wire format is
 * unit-testable; this handler only does transport and lookup.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.info('Received Facebook webhook event')

  // 1. Verify Request Signature (CRITICAL FOR SECURITY)
  const signature = req.headers.get('x-hub-signature-256')
  if (!signature) {
    logger.error('Missing X-Hub-Signature-256 header. Rejecting request.')
    return NextResponse.json({ error: 'Forbidden: Missing signature' }, { status: 403 })
  }
  const bodyText = await req.text()
  const verified = verifyWebhook(metaPreset, {
    rawBody: bodyText,
    headers: { 'x-hub-signature-256': signature },
    secret: configService.get<string>('FACEBOOK_APP_SECRET') ?? null,
  })
  if (!verified) {
    logger.error('Invalid X-Hub-Signature-256. Request rejected.')
    return NextResponse.json({ error: 'Forbidden: Invalid signature' }, { status: 403 })
  }
  logger.debug('Facebook webhook signature verified successfully.')

  // 2. Parse the validated body
  let payload: MetaWebhookEnvelope
  try {
    payload = JSON.parse(bodyText) as MetaWebhookEnvelope
  } catch (e) {
    logger.error('Failed to parse Facebook webhook payload:', { error: e })
    return NextResponse.json({ error: 'Bad Request: Invalid JSON' }, { status: 400 })
  }

  // 3. Process the events
  if (payload.object === 'page') {
    const storageService = new MessageStorageService()
    // One profile fetch per counterpart per delivery. Meta batches several
    // events into one POST, and a burst from the same person would otherwise
    // schedule the same Graph call once per message.
    const scheduledNameLookups = new Set<string>()
    const processingPromises = (payload.entry ?? []).map(async (entry) => {
      // Post comments / feed activity ride on `entry.changes`, a different envelope
      // with different identity (comment ids, not PSIDs). We do not subscribe to
      // `feed` today so this never fires; the branch exists so adding comments is a
      // filled-in case rather than a restructure. See WS10 of the FB/IG plan.
      if (entry.changes?.length) {
        logger.debug('Ignoring Facebook feed/changes event (comments not yet ingested).', {
          entryId: entry.id,
          changeCount: entry.changes.length,
        })
      }

      if (!entry.messaging || !Array.isArray(entry.messaging)) {
        logger.debug('Skipping entry without messaging array.', { entryId: entry.id })
        return
      }

      for (const event of entry.messaging as MetaWebhookMessagingEvent[]) {
        if (!event.message) {
          if (event.delivery) {
            logger.debug('Received delivery confirmation, ignoring.', { event })
          } else if (event.read) {
            logger.debug('Received read receipt, ignoring.', { event })
          } else {
            logger.debug('Received unhandled Facebook messaging event type:', { event })
          }
          continue
        }

        // Echoes are the page's own sends played back. Dropped for now — a reply
        // typed in Meta Business Suite will not appear in Auxx until WS4 decides
        // the reconciliation policy.
        if (event.message.is_echo) {
          logger.debug('Received message echo, ignoring.', { mid: event.message.mid })
          continue
        }

        const recipientPageId = event.recipient?.id
        if (!recipientPageId) {
          logger.warn('Facebook messaging event has no recipient page id; skipping.', { event })
          continue
        }

        // `isNull(deletedAt)`: disconnect is a soft delete, so without this a
        // disconnected channel keeps ingesting for as long as `enabled` stayed true.
        const [integration] = await db
          .select({
            id: schema.Integration.id,
            organizationId: schema.Integration.organizationId,
            metadata: schema.Integration.metadata,
          })
          .from(schema.Integration)
          .where(
            and(
              eq(schema.Integration.provider, 'facebook'),
              eq(schema.Integration.enabled, true),
              isNull(schema.Integration.deletedAt),
              sql`${schema.Integration.metadata} ->> 'pageId' = ${recipientPageId}`
            )
          )
          .limit(1)

        if (!integration) {
          logger.warn(
            `No active Facebook integration found for Page ID ${recipientPageId}. Skipping message.`
          )
          continue
        }

        const messageData = convertMetaWebhookEventToMessageData({
          event,
          integrationId: integration.id,
          organizationId: integration.organizationId,
          pageId: recipientPageId,
          platform: 'facebook',
          metadata: integration.metadata as SocialIntegrationMetadata | null,
        })

        if (!messageData) {
          logger.warn('Failed to convert webhook event to MessageData', { event })
          continue
        }

        try {
          await storageService.storeMessage(messageData)
          logger.info('Successfully stored Facebook message', {
            mid: event.message.mid,
            integrationId: integration.id,
            externalThreadId: messageData.externalThreadId,
          })

          // Meta's messaging webhook carries only `sender.id`, so the counterpart
          // participant was just created with the raw id as its label. Resolving a
          // real name costs a Graph call, which must NOT happen before the 200:
          // Meta retries a slow webhook and eventually disables the subscription.
          // `after()` runs it once the response is already on the wire.
          const counterpartId = event.sender?.id
          const lookupKey = `${integration.id}:${counterpartId}`
          if (counterpartId && !scheduledNameLookups.has(lookupKey)) {
            scheduledNameLookups.add(lookupKey)
            after(() =>
              resolveSocialCounterpartName(db, {
                platform: 'facebook',
                organizationId: integration.organizationId,
                integrationId: integration.id,
                counterpartId,
              })
            )
          }
        } catch (storeError) {
          logger.error('Failed to store Facebook message', {
            mid: event.message.mid,
            integrationId: integration.id,
            error: storeError instanceof Error ? storeError.message : String(storeError),
          })
        }
      }
    })

    await Promise.allSettled(processingPromises)
  } else {
    logger.warn(`Received webhook event for unexpected object type: ${payload.object}`)
  }

  // 4. Respond with 200 OK quickly — Facebook retries and eventually disables
  // subscriptions that do not answer fast.
  return NextResponse.json({ status: 'success' }, { status: 200 })
}
