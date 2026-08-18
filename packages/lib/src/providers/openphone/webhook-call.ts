// packages/lib/src/providers/openphone/webhook-call.ts

import { createScopedLogger } from '@auxx/logger'
import type { MessageData } from '../../ingest/types'
import { MessageType } from '../types'
import type { OpenPhoneIntegrationMetadata, QuoWebhookCall, QuoWebhookEvent } from './types'

const logger = createScopedLogger('quo-webhook-call')

/**
 * The `Message.metadata.call` contract. This is the ONLY window the read path
 * (`message-query.service.ts`) projects onto `MessageMeta.callMeta` — everything else in
 * `metadata.quo_webhook_event` stays internal. Treat a field rename here as a breaking API
 * change for the UI.
 */
export interface QuoCallMeta {
  direction: 'incoming' | 'outgoing'
  answered: boolean
  answeredAt: string | null
  completedAt: string | null
  durationSeconds: number | null
}

/** `125` seconds → `"2:05"`. */
function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Converts a Quo `call.completed` webhook event into `MessageData`.
 *
 * Mirrors `webhook-message.ts`'s shape and mapper style — same envelope, same
 * from/to/direction handling, same "never throws, null means ack-and-drop" contract — so
 * threading, participant resolution and reconciliation behave identically to a text message on
 * the same integration. The two things a call adds:
 *
 * - `messageType` is `VOICEMAIL` when the call carries voicemail audio, else `CALL` (an
 *   answered call and a missed call with no voicemail are both `CALL` — `answered` lives in
 *   `metadata.call` instead of earning its own type; see message-type-overhaul plan §2.3).
 * - `hasAttachments` is true iff a voicemail is present. The recording (when one exists) arrives
 *   later on its own `call.recording.completed` event and is attached to this same message row
 *   by the webhook route, which flips `hasAttachments` at that point if needed.
 *
 * @param conversationId Recovered by the caller from the envelope's `deepLink`, exactly like the
 *   message mapper — the call payload carries no `conversationId` either.
 * @returns `null` when the event is unusable, which the caller treats as "ack and drop".
 */
export function convertQuoWebhookCallEventToMessageData(
  event: QuoWebhookEvent<QuoWebhookCall>,
  integrationId: string,
  organizationId: string,
  metadata: OpenPhoneIntegrationMetadata | null,
  conversationId: string | null
): MessageData | null {
  const call = event.data?.object
  if (!call?.id) {
    logger.error('Cannot convert Quo webhook call event: no call object on the payload.', {
      eventId: event.id,
    })
    return null
  }

  try {
    const isInbound = call.direction === 'incoming'
    // Quo puts both sides on the payload. `metadata.phoneNumber` is only a fallback for our own
    // side of the exchange — same convention as the message mapper.
    const ourNumber = metadata?.phoneNumber
    const fromNumber = call.from || (isInbound ? undefined : ourNumber)
    const toNumber = call.to || (isInbound ? ourNumber : undefined)

    if (!fromNumber || !toNumber) {
      logger.warn('Missing caller or callee number on Quo call webhook', {
        callId: call.id,
        eventType: event.type,
      })
      return null
    }

    const createdTime = new Date(call.createdAt)
    if (Number.isNaN(createdTime.getTime())) {
      logger.warn('Unparseable createdAt on Quo call webhook', {
        callId: call.id,
        createdAt: call.createdAt,
      })
      return null
    }

    const hasVoicemail = call.voicemail != null
    const answered = call.answeredAt != null

    let durationSeconds: number | null = null
    if (hasVoicemail) {
      durationSeconds = call.voicemail?.duration ?? null
    } else if (answered && call.answeredAt && call.completedAt) {
      const answeredMs = new Date(call.answeredAt).getTime()
      const completedMs = new Date(call.completedAt).getTime()
      if (
        Number.isFinite(answeredMs) &&
        Number.isFinite(completedMs) &&
        completedMs >= answeredMs
      ) {
        durationSeconds = Math.round((completedMs - answeredMs) / 1000)
      }
    }

    let snippet: string
    if (hasVoicemail) {
      snippet =
        durationSeconds != null ? `Voicemail (${formatDuration(durationSeconds)})` : 'Voicemail'
    } else if (answered) {
      const label = isInbound ? 'Call' : 'Outgoing call'
      snippet = durationSeconds != null ? `${label} (${formatDuration(durationSeconds)})` : label
    } else {
      snippet = 'Missed call'
    }

    const callMeta: QuoCallMeta = {
      direction: call.direction,
      answered,
      answeredAt: call.answeredAt ?? null,
      completedAt: call.completedAt ?? null,
      durationSeconds,
    }

    return {
      externalId: call.id,
      externalThreadId: conversationId ?? undefined,
      integrationId,
      organizationId,
      createdTime,
      sentAt: createdTime,
      receivedAt: createdTime,
      subject: null, // Calls have no subject, same as SMS.
      from: { identifier: fromNumber },
      to: [{ identifier: toNumber }],
      cc: [],
      bcc: [],
      replyTo: [],
      messageType: hasVoicemail ? MessageType.VOICEMAIL : MessageType.CALL,
      // A voicemail claims an attachment because the webhook route fetches and ingests it
      // synchronously right after this row is stored. A plain call/missed-call has nothing to
      // attach yet — a recording, if any, arrives later on `call.recording.completed` and the
      // route flips this itself when it lands.
      hasAttachments: hasVoicemail,
      textPlain: snippet,
      snippet,
      isInbound,
      metadata: { call: callMeta, quo_webhook_event: event },
      keywords: [],
      labelIds: [],
    } satisfies MessageData
  } catch (error) {
    logger.error('Failed to convert Quo webhook call event data', {
      error: error instanceof Error ? error.message : String(error),
      eventId: event.id,
    })
    return null
  }
}
