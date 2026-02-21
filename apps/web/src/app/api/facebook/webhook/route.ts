// apps/web/src/app/api/facebook/webhook/route.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import type { MessageData } from '@auxx/lib/email'
import { MessageStorageService } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

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
  // Check if mode and token are present
  if (mode && token) {
    // Check the mode and token sent are correct
    if (
      mode === 'subscribe' &&
      token === configService.get<string>('FACEBOOK_WEBHOOK_VERIFY_TOKEN')
    ) {
      // Respond with the challenge token from the request
      logger.info('Facebook webhook verification successful.')
      return new NextResponse(challenge, { status: 200 })
    } else {
      // Respond with '403 Forbidden' if verify tokens do not match
      logger.warn('Facebook webhook verification failed: Invalid mode or token.')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } else {
    logger.warn('Facebook webhook verification failed: Missing mode or token.')
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 })
  }
}
/**
 * Handles incoming Facebook webhook events (POST request).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.info('Received Facebook webhook event')
  // 1. Verify Request Signature (CRITICAL FOR SECURITY)
  const signature = req.headers.get('x-hub-signature-256')
  if (!signature) {
    logger.error('Missing X-Hub-Signature-256 header. Rejecting request.')
    return NextResponse.json({ error: 'Forbidden: Missing signature' }, { status: 403 })
  }
  const bodyText = await req.text() // Read body as text for signature verification
  const expectedHash = crypto
    .createHmac('sha256', configService.get<string>('FACEBOOK_APP_SECRET')!) // Ensure App Secret is set
    .update(bodyText)
    .digest('hex')
  if (signature !== `sha256=${expectedHash}`) {
    logger.error('Invalid X-Hub-Signature-256. Request rejected.')
    return NextResponse.json({ error: 'Forbidden: Invalid signature' }, { status: 403 })
  }
  logger.debug('Facebook webhook signature verified successfully.')
  // 2. Parse the validated body
  let payload: any
  try {
    payload = JSON.parse(bodyText)
  } catch (e) {
    logger.error('Failed to parse Facebook webhook payload:', { error: e })
    return NextResponse.json({ error: 'Bad Request: Invalid JSON' }, { status: 400 })
  }
  // 3. Process the events
  if (payload.object === 'page') {
    const storageService = new MessageStorageService()
    // Use Promise.allSettled to process entries concurrently and handle errors gracefully
    const processingPromises = payload.entry?.map(async (entry: any) => {
      // Check if entry has messaging events
      if (!entry.messaging || !Array.isArray(entry.messaging)) {
        logger.debug('Skipping entry without messaging array.', { entryId: entry.id })
        return // Skip entries without messaging events
      }
      for (const event of entry.messaging) {
        if (event.message && !event.message.is_echo) {
          // Process incoming messages (ignore echoes from page)
          const senderPsid = event.sender.id
          const recipientPageId = event.recipient.id
          const timestamp = event.timestamp
          const messageContent = event.message
          logger.info(`Processing incoming Facebook message`, {
            senderPsid,
            pageId: recipientPageId,
            mid: messageContent.mid,
          })
          // Find the integration associated with the Page ID
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
                sql`${schema.Integration.metadata} ->> 'pageId' = ${recipientPageId}`
              )
            )
            .limit(1)
          if (!integration) {
            logger.warn(
              `No active Facebook integration found for Page ID ${recipientPageId}. Skipping message.`
            )
            continue // Skip if no matching integration
          }
          // Convert webhook event to MessageData format
          const messageData = convertWebhookEventToMessageData(
            event,
            integration.id,
            integration.organizationId,
            integration.metadata as unknown as Record<string, any> | null // Pass metadata
          )
          if (messageData) {
            try {
              await storageService.storeMessage(messageData)
              logger.info(`Successfully stored Facebook message`, {
                mid: messageContent.mid,
                integrationId: integration.id,
              })
            } catch (storeError: any) {
              logger.error(`Failed to store Facebook message`, {
                mid: messageContent.mid,
                integrationId: integration.id,
                error: storeError.message,
              })
              // Decide if we should throw/retry based on the error (e.g., unique constraint vs. DB down)
            }
          } else {
            logger.warn('Failed to convert webhook event to MessageData', { event })
          }
        } else if (event.delivery) {
          logger.debug('Received delivery confirmation, ignoring.', { event })
        } else if (event.read) {
          logger.debug('Received read receipt, ignoring.', { event })
        } else if (event.message?.is_echo) {
          logger.debug('Received message echo, ignoring.', { event })
        } else {
          logger.debug('Received unhandled Facebook messaging event type:', event)
        }
      }
    })
    // Wait for all entries to be processed
    await Promise.allSettled(processingPromises)
  } else {
    logger.warn(`Received webhook event for unexpected object type: ${payload.object}`)
  }
  // 4. Respond with 200 OK quickly
  // Facebook requires a quick response to avoid retries and webhook disabling.
  return NextResponse.json({ status: 'success' }, { status: 200 })
}
/**
 * Helper function to convert a Facebook webhook messaging event into MessageData.
 */
function convertWebhookEventToMessageData(
  event: any,
  integrationId: string,
  organizationId: string,
  integrationMetadata: { pageName: string } | null
): MessageData | null {
  try {
    const senderPsid = event.sender.id
    const recipientPageId = event.recipient.id
    const timestamp = event.timestamp
    const message = event.message
    const messageId = message.mid
    const pageName = integrationMetadata?.pageName as string | undefined
    // Determine direction
    // This assumes webhooks only receive messages sent TO the page
    const isInbound = true // Webhook messages are typically inbound
    const fromParticipant = { name: undefined, address: senderPsid } // Name might be fetched later
    const toParticipant = { name: pageName, address: recipientPageId }
    const text = message.text
    const attachments = (message.attachments || []).map((att: any) => ({
      filename: att.payload?.title || att.type || 'attachment',
      mimeType: att.type,
      size: 0,
      inline: false,
      contentLocation: att.payload?.url,
    }))
    const createdTime = new Date(timestamp)
    const messageData: MessageData = {
      externalId: messageId,
      // Need a way to associate with a conversation/thread ID.
      // Facebook doesn't send conversation ID in message webhook.
      // We might need to look up conversation based on sender/recipient pair or store it separately.
      // Using sender PSID as a temporary proxy for thread ID - **THIS IS NOT CORRECT**, needs proper conversation mapping.
      externalThreadId: senderPsid, // <<< !!! Placeholder - Needs Conversation ID Mapping !!!
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
      metadata: { event: event }, // Store the raw event
      keywords: [],
      labelIds: [],
    }
    return messageData
  } catch (error: any) {
    logger.error('Failed to convert Facebook webhook event', { error: error.message, event })
    return null
  }
}
