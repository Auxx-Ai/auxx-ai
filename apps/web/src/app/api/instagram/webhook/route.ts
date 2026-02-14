// apps/web/src/app/api/instagram/webhook/route.ts

import { env } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import type { MessageData } from '@auxx/lib/email'
import { MessageStorageService } from '@auxx/lib/email'
import type { InstagramIntegrationMetadata } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
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

  if (mode === 'subscribe' && token === env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
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
  const expectedHash = crypto
    .createHmac('sha256', env.FACEBOOK_APP_SECRET!)
    .update(bodyText)
    .digest('hex')

  if (signature !== `sha256=${expectedHash}`) {
    logger.error('Invalid X-Hub-Signature-256 for Instagram webhook. Rejecting.')
    return NextResponse.json({ error: 'Forbidden: Invalid signature' }, { status: 403 })
  }
  logger.debug('Instagram webhook signature verified.')

  // 2. Parse Body
  let payload: any
  try {
    payload = JSON.parse(bodyText)
  } catch (e) {
    logger.error('Failed to parse Instagram webhook payload:', { error: e })
    return NextResponse.json({ error: 'Bad Request: Invalid JSON' }, { status: 400 })
  }

  // 3. Process Instagram Events
  if (payload.object === 'instagram') {
    const storageService = new MessageStorageService()
    const processingPromises = payload.entry?.map(async (entry: any) => {
      if (!entry.messaging || !Array.isArray(entry.messaging)) {
        logger.debug('Skipping Instagram entry without messaging array.', { entryId: entry.id })
        return
      }

      for (const event of entry.messaging) {
        // Check for actual message events and ignore echoes
        if (event.message && !event.message.is_echo) {
          const senderIgsid = event.sender.id // Instagram Scoped User ID
          const recipientIgbid = event.recipient.id // Instagram Business Account ID
          const messageContent = event.message
          // const timestamp = event.timestamp

          logger.info(`Processing incoming Instagram message`, {
            senderIgsid,
            recipientIgbid,
            mid: messageContent.mid,
          })

          // Find the integration based on the recipient IGBID
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

          // Convert and store the message
          const messageData = convertInstagramWebhookEventToMessageData(
            event,
            integration.id,
            integration.organizationId,
            integration.metadata as unknown as Record<string, any> | null
          )

          if (messageData) {
            try {
              await storageService.storeMessage(messageData)
              logger.info(`Successfully stored Instagram message`, {
                mid: messageContent.mid,
                integrationId: integration.id,
              })
            } catch (storeError: any) {
              logger.error(`Failed to store Instagram message`, {
                mid: messageContent.mid,
                integrationId: integration.id,
                error: storeError.message,
              })
            }
          } else {
            logger.warn('Failed to convert Instagram webhook event to MessageData', { event })
          }
        } else {
          // Handle or ignore other event types (delivery, read, echo)
          logger.debug('Ignoring non-message or echo event in Instagram webhook:', {
            eventType: event.message ? 'echo' : Object.keys(event)[0],
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

/**
 * Helper to convert Instagram webhook event to MessageData.
 */
function convertInstagramWebhookEventToMessageData(
  event: any,
  integrationId: string,
  organizationId: string,
  integrationMetadata: Partial<InstagramIntegrationMetadata>
): MessageData | null {
  try {
    const senderIgsid = event.sender.id
    const recipientIgbid = event.recipient.id // This is our IGBID
    const timestamp = event.timestamp
    const message = event.message
    const messageId = message.mid // Instagram message ID

    const metadata = integrationMetadata
    const igUsername = metadata?.instagramUsername // Our username

    // Directionality: Webhook always receives messages sent TO the business account
    const isInbound = true

    const fromParticipant = { name: undefined, address: senderIgsid } // Sender is the user (IGSID)
    const toParticipant = { name: igUsername, address: recipientIgbid } // Recipient is the business (IGBID)

    const text = message.text
    const attachments = (message.attachments || []).map((att: any) => ({
      filename: att.payload?.title || att.type || 'attachment',
      mimeType: att.type,
      size: 0,
      inline: false,
      contentLocation: att.payload?.url,
    }))

    const createdTime = new Date(timestamp)

    // Determine Thread ID: Requires mapping IGSID to a conversation ID.
    // This mapping isn't provided directly. A common approach is to fetch
    // the conversation ID using the page ID and user IGSID, or use the
    // IGSID itself as a proxy (less ideal as it doesn't group threads correctly
    // if the same user messages via FB Messenger and Instagram).
    // Using IGSID as placeholder - !!! NEEDS REPLACEMENT WITH CONVERSATION LOOKUP/MAPPING !!!
    const externalThreadId = senderIgsid

    const messageData: MessageData = {
      externalId: messageId,
      externalThreadId: externalThreadId, // Placeholder - fetch conversation ID
      integrationId: integrationId,
      // Note: integrationType and messageType removed - derived from Integration.provider
      organizationId: organizationId,
      createdTime: createdTime,
      sentAt: createdTime,
      receivedAt: createdTime,
      subject: undefined,
      from: fromParticipant,
      to: [toParticipant],
      cc: [],
      bcc: [],
      replyTo: [],
      hasAttachments: attachments.length > 0,
      attachments: attachments,
      textPlain: text,
      snippet: text ? text.substring(0, 100) : attachments[0]?.filename || '',
      isInbound: isInbound,
      metadata: { event: event },
      keywords: [],
      labelIds: [],
      emailLabel: EmailLabel.inbox,
    }

    return messageData
  } catch (error: any) {
    logger.error('Failed to convert Instagram webhook event', { error: error.message, event })
    return null
  }
}
