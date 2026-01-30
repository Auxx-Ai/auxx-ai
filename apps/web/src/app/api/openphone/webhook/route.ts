// apps/web/src/app/api/openphone/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { database as db, schema } from '@auxx/database'
import { MessageStorageService } from '@auxx/lib/email'
import type { MessageData } from '@auxx/lib/email'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import {
  OpenPhoneIntegrationMetadata,
  OpenPhoneWebhookEvent,
  OpenPhoneMessageReceivedData,
} from '@auxx/lib/providers/openphone/types' // Adjust path

const logger = createScopedLogger('openphone-webhook')

/**
 * Handles incoming OpenPhone webhook events (POST request).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  logger.info('Received OpenPhone webhook event')
  let bodyText: string
  let payload: OpenPhoneWebhookEvent

  try {
    // 1. Read body first for signature verification
    bodyText = await req.text()
    if (!bodyText) {
      logger.warn('Received empty request body for OpenPhone webhook.')
      return NextResponse.json({ error: 'Bad Request: Empty body' }, { status: 400 })
    }

    // 2. Parse the body (do this *after* reading text for signature)
    payload = JSON.parse(bodyText)
    logger.debug('Parsed OpenPhone webhook payload', { type: payload?.type, eventId: payload?.id })

    // 3. Find the relevant Integration based on webhook data
    // We need a piece of data that uniquely identifies the integration.
    // The webhook payload itself doesn't directly contain our integration ID.
    // It usually contains the phone number ID (`data.phone_number_id` for messages)
    // that received the event. We use this to look up the integration.

    let phoneNumberId: string | undefined
    if (payload.type?.startsWith('message.') && payload.data?.phone_number_id) {
      phoneNumberId = payload.data.phone_number_id
    } else if (payload.type?.startsWith('call.') && payload.data?.phone_number?.id) {
      phoneNumberId = payload.data.phone_number.id
    }
    // Add other event type checks if needed

    if (!phoneNumberId) {
      logger.warn('Could not determine phone_number_id from webhook payload to find integration.', {
        payloadType: payload.type,
      })
      // Respond OK even if we can't process, to prevent OpenPhone retries for irrelevant events.
      return NextResponse.json({ status: 'success - cannot identify integration' }, { status: 200 })
    }

    const [integration] = await db
      .select({ id: schema.Integration.id, organizationId: schema.Integration.organizationId, metadata: schema.Integration.metadata })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.provider, 'openphone'),
          eq(schema.Integration.enabled, true),
          sql`${schema.Integration.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`
        )
      )
      .limit(1)

    if (!integration || !integration.metadata) {
      logger.warn(
        `No active OpenPhone integration found for phoneNumberId ${phoneNumberId}. Ignoring webhook event.`,
        { eventType: payload.type }
      )
      // Respond OK to acknowledge receipt
      return NextResponse.json({ status: 'success - no integration found' }, { status: 200 })
    }
    const metadata = integration.metadata as unknown as OpenPhoneIntegrationMetadata
    const signingSecret = metadata.webhookSigningSecret

    // 4. Verify Request Signature
    const signature = req.headers.get('x-openphone-signature')
    if (!signature) {
      logger.error('Missing X-Openphone-Signature header. Rejecting request.')
      return NextResponse.json({ error: 'Forbidden: Missing signature' }, { status: 403 })
    }
    if (!signingSecret) {
      logger.error(
        `Missing webhook signing secret for integration ${integration.id}. Cannot verify signature.`
      )
      return NextResponse.json(
        { error: 'Configuration Error: Missing signing secret' },
        { status: 500 }
      )
    }

    const expectedSignature = crypto
      .createHmac('sha256', signingSecret)
      .update(bodyText) // Use the raw body text read earlier
      .digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      logger.error('Invalid X-Openphone-Signature. Request rejected.', {
        integrationId: integration.id,
      })
      return NextResponse.json({ error: 'Forbidden: Invalid signature' }, { status: 403 })
    }
    logger.debug('OpenPhone webhook signature verified successfully.')

    // 5. Process Supported Events
    const storageService = new MessageStorageService()

    switch (payload.type) {
      case 'message.received':
        logger.info(`Processing message.received event`, {
          eventId: payload.id,
          integrationId: integration.id,
        })
        const messageData = convertOpenPhoneWebhookEventToMessageData(
          payload.data as OpenPhoneMessageReceivedData,
          integration.id,
          integration.organizationId,
          metadata // Pass metadata for context (e.g., our phone number)
        )
        if (messageData) {
          try {
            await storageService.storeMessage(messageData)
            logger.info(`Successfully stored OpenPhone message`, {
              mid: messageData.externalId,
              integrationId: integration.id,
            })
          } catch (storeError: any) {
            logger.error(`Failed to store OpenPhone message`, {
              mid: messageData.externalId,
              integrationId: integration.id,
              error: storeError.message,
            })
            // Decide if we should return 500 to trigger retry
            // If it's a unique constraint (P2002), message likely processed, return 200.
            if (storeError && typeof storeError === 'object' && (storeError as any).code === 'P2002') {
              logger.warn('Message likely already processed (unique constraint violation).', {
                mid: messageData.externalId,
              })
              // Fall through to return 200 OK
            } else {
              // For other errors, maybe return 500?
              return NextResponse.json({ error: 'Failed to store message' }, { status: 500 })
            }
          }
        } else {
          logger.warn('Failed to convert message.received event data', { eventId: payload.id })
        }
        break

      case 'call.ringing':
        // TODO: Handle incoming call event (e.g., create notification, log event)
        logger.info(`Received call.ringing event`, { eventId: payload.id, data: payload.data })
        break

      case 'call.finished':
        // TODO: Handle finished call event (e.g., store call log as a Message)
        logger.info(`Received call.finished event`, { eventId: payload.id, data: payload.data })
        // Potentially convert payload.data (call object) into a MessageData with MessageType.CALL
        break

      // Add cases for other events you subscribe to

      default:
        logger.debug(`Ignoring unhandled OpenPhone event type: ${payload.type}`)
    }

    // 6. Respond OK
    return NextResponse.json({ status: 'success' }, { status: 200 })
  } catch (error: any) {
    logger.error('Error processing OpenPhone webhook:', {
      error: error.message,
      stack: error.stack,
    })
    // Return 500 for unexpected internal errors
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Helper function to convert an OpenPhone webhook message event into MessageData.
 */
function convertOpenPhoneWebhookEventToMessageData(
  messagePayload: OpenPhoneMessageReceivedData,
  integrationId: string,
  organizationId: string,
  metadata: OpenPhoneIntegrationMetadata | null
): MessageData | null {
  if (!metadata?.phoneNumber) {
    logger.error('Cannot convert webhook event, missing integration metadata (phoneNumber).')
    return null
  }
  try {
    const externalId = messagePayload.id
    const externalThreadId = messagePayload.conversation_id
    const createdTime = new Date(messagePayload.date_created)

    // Webhook 'message.received' is always inbound
    const isInbound = true
    const fromNumber = messagePayload.sender_phone_number
    const toNumber = metadata.phoneNumber // Our number

    if (!fromNumber) {
      logger.warn('Missing sender number in message.received webhook', { messageId: externalId })
      return null // Cannot process without sender
    }

    const fromParticipant = { address: fromNumber }
    const toParticipant = { address: toNumber }

    const attachments = (messagePayload.attachments || []).map((att: OpenPhoneAttachment) => ({
      id: att.id,
      filename: att.file_name,
      mimeType: att.content_type,
      size: att.size_bytes,
      inline: false,
      contentLocation: att.url,
    }))

    const messageData: MessageData = {
      externalId: externalId,
      externalThreadId: externalThreadId,
      integrationId: integrationId,
      // Note: integrationType and messageType removed - derived from Integration.provider
      organizationId: organizationId,
      createdTime: createdTime,
      sentAt: createdTime, // For inbound, sentAt=receivedAt=createdTime
      receivedAt: createdTime,
      subject: undefined,
      from: fromParticipant,
      to: [toParticipant],
      cc: [],
      bcc: [],
      replyTo: [],
      hasAttachments: attachments.length > 0,
      attachments: attachments,
      textPlain: messagePayload.body,
      snippet: messagePayload.body?.substring(0, 100),
      isInbound: isInbound,
      metadata: { openphone_webhook_event_data: messagePayload },
      keywords: [],
      labelIds: [],
    }

    return messageData
  } catch (error: any) {
    logger.error('Failed to convert OpenPhone webhook event data', {
      error: error.message,
      payload: messagePayload,
    })
    return null
  }
}
