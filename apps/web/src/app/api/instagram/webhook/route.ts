// apps/web/src/app/api/instagram/webhook/route.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { MessageStorageService } from '@auxx/lib/email'
import type {
  MetaWebhookEnvelope,
  MetaWebhookMessagingEvent,
  SocialIntegrationMetadata,
} from '@auxx/lib/providers/social/types'
import { convertMetaWebhookEventToMessageData } from '@auxx/lib/providers/social/webhook-message'
import { metaPreset, verifyWebhook } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('instagram-webhook')

/**
 * Handles Facebook/Instagram webhook verification (GET request).
 * Note: Instagram webhooks are configured via the Facebook App Dashboard.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  logger.info('Received Instagram (via Facebook) webhook verification request', { mode, token })

  if (
    mode === 'subscribe' &&
    token === configService.get<string>('FACEBOOK_WEBHOOK_VERIFY_TOKEN')
  ) {
    logger.info('Instagram webhook verification successful.')
    return new NextResponse(challenge, { status: 200 })
  } else {
    logger.warn('Instagram webhook verification failed: Invalid mode or token.')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

/**
 * Handles incoming Instagram webhook events (POST request).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.info('Received Instagram (via Facebook) webhook event')

  // 1. Verify Signature
  const signature = req.headers.get('x-hub-signature-256')
  if (!signature) {
    logger.error('Missing X-Hub-Signature-256 header for Instagram webhook. Rejecting.')
    return NextResponse.json({ error: 'Forbidden: Missing signature' }, { status: 403 })
  }
  const bodyText = await req.text()
  const verified = verifyWebhook(metaPreset, {
    rawBody: bodyText,
    headers: { 'x-hub-signature-256': signature },
    secret: configService.get<string>('FACEBOOK_APP_SECRET') ?? null,
  })

  if (!verified) {
    logger.error('Invalid X-Hub-Signature-256 for Instagram webhook. Rejecting.')
    return NextResponse.json({ error: 'Forbidden: Invalid signature' }, { status: 403 })
  }
  logger.debug('Instagram webhook signature verified.')

  // 2. Parse Body
  let payload: MetaWebhookEnvelope
  try {
    payload = JSON.parse(bodyText) as MetaWebhookEnvelope
  } catch (e) {
    logger.error('Failed to parse Instagram webhook payload:', { error: e })
    return NextResponse.json({ error: 'Bad Request: Invalid JSON' }, { status: 400 })
  }

  // 3. Process Instagram Events
  if (payload.object === 'instagram') {
    const storageService = new MessageStorageService()
    const processingPromises = (payload.entry ?? []).map(async (entry) => {
      // Comments / mentions ride on `entry.changes`, a different envelope with
      // different identity. Not subscribed today; the branch exists so WS10 is a
      // filled-in case rather than a restructure.
      if (entry.changes?.length) {
        logger.debug('Ignoring Instagram changes event (comments not yet ingested).', {
          entryId: entry.id,
          changeCount: entry.changes.length,
        })
      }

      if (!entry.messaging || !Array.isArray(entry.messaging)) {
        logger.debug('Skipping Instagram entry without messaging array.', { entryId: entry.id })
        return
      }

      for (const event of entry.messaging as MetaWebhookMessagingEvent[]) {
        if (!event.message) {
          logger.debug('Ignoring non-message event in Instagram webhook:', {
            eventType: Object.keys(event)[0],
          })
          continue
        }

        if (event.message.is_echo) {
          logger.debug('Received Instagram message echo, ignoring.', { mid: event.message.mid })
          continue
        }

        const recipientIgbid = event.recipient?.id
        if (!recipientIgbid) {
          logger.warn('Instagram messaging event has no recipient IGBID; skipping.', { event })
          continue
        }

        // `isNull(deletedAt)`: disconnect is a soft delete, so without this a
        // disconnected channel keeps ingesting while `enabled` stayed true.
        const [integration] = await db
          .select({
            id: schema.Integration.id,
            organizationId: schema.Integration.organizationId,
            metadata: schema.Integration.metadata,
          })
          .from(schema.Integration)
          .where(
            and(
              eq(schema.Integration.provider, 'instagram'),
              eq(schema.Integration.enabled, true),
              isNull(schema.Integration.deletedAt),
              sql`${schema.Integration.metadata} ->> 'instagramBusinessAccountId' = ${recipientIgbid}`
            )
          )
          .limit(1)

        if (!integration) {
          logger.warn(
            `No active Instagram integration found for IGBID ${recipientIgbid}. Skipping message.`
          )
          continue
        }

        const messageData = convertMetaWebhookEventToMessageData({
          event,
          integrationId: integration.id,
          organizationId: integration.organizationId,
          pageId: recipientIgbid,
          platform: 'instagram',
          metadata: integration.metadata as SocialIntegrationMetadata | null,
        })

        if (!messageData) {
          logger.warn('Failed to convert Instagram webhook event to MessageData', { event })
          continue
        }

        try {
          await storageService.storeMessage(messageData)
          logger.info('Successfully stored Instagram message', {
            mid: event.message.mid,
            integrationId: integration.id,
            externalThreadId: messageData.externalThreadId,
          })
        } catch (storeError) {
          logger.error('Failed to store Instagram message', {
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

  // 4. Respond OK quickly
  return NextResponse.json({ status: 'success' }, { status: 200 })
}
