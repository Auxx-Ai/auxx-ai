// packages/lib/src/providers/openphone/__tests__/webhook-call.test.ts

import { describe, expect, it } from 'vitest'
import { MessageType } from '../../types'
import type { QuoWebhookCall, QuoWebhookEvent } from '../types'
import { convertQuoWebhookCallEventToMessageData } from '../webhook-call'

/**
 * NOT captured from a live event — we don't subscribe to call events yet (this is the mapper
 * that makes subscribing to them safe). Built strictly from the documented/verified shape in
 * `types.ts` (`QuoWebhookCall`), which mirrors the message shape plus voicemail/recording media,
 * `answeredAt`, `completedAt`. Per `webhook-message.test.ts`'s convention: when a real captured
 * `call.completed` payload lands in `Message.metadata.quo_webhook_event`, replace this fixture
 * with it rather than hand-editing this one further.
 */
const ANSWERED_INBOUND: QuoWebhookEvent<QuoWebhookCall> = {
  id: 'EVcall_answered_inbound',
  object: 'event',
  apiVersion: 'v4',
  createdAt: '2026-08-17T10:00:00.000Z',
  type: 'call.completed',
  data: {
    object: {
      id: 'AC_redacted_call_id',
      object: 'call',
      to: '+18889155797',
      from: '+15102055536',
      direction: 'incoming',
      status: 'completed',
      answeredAt: '2026-08-17T10:00:05.000Z',
      completedAt: '2026-08-17T10:02:18.000Z', // 2:13 after answeredAt
      createdAt: '2026-08-17T10:00:00.000Z',
      userId: 'USLPYvl8qp',
      phoneNumberId: 'PN0eLoM7TQ',
    },
    deepLink:
      'https://my.quo.com/inbox/PN0eLoM7TQ/c/CNa71b750b888a4cdd81cd3a1ff0f8c0a9?at=AC_redacted_call_id',
  },
}

const MISSED_NO_VOICEMAIL: QuoWebhookEvent<QuoWebhookCall> = {
  ...ANSWERED_INBOUND,
  id: 'EVcall_missed',
  data: {
    ...ANSWERED_INBOUND.data,
    object: {
      ...ANSWERED_INBOUND.data.object,
      id: 'AC_redacted_missed_call_id',
      answeredAt: null,
      completedAt: '2026-08-17T10:00:12.000Z',
    },
  },
}

const VOICEMAIL: QuoWebhookEvent<QuoWebhookCall> = {
  ...ANSWERED_INBOUND,
  id: 'EVcall_voicemail',
  data: {
    ...ANSWERED_INBOUND.data,
    object: {
      ...ANSWERED_INBOUND.data.object,
      id: 'AC_redacted_voicemail_call_id',
      answeredAt: null,
      completedAt: '2026-08-17T10:00:50.000Z',
      voicemail: { url: 'https://cdn.quo.example/vm.mp3', type: 'audio/mpeg', duration: 42 },
    },
  },
}

const OUTGOING_ANSWERED: QuoWebhookEvent<QuoWebhookCall> = {
  ...ANSWERED_INBOUND,
  id: 'EVcall_outgoing_answered',
  data: {
    ...ANSWERED_INBOUND.data,
    object: {
      ...ANSWERED_INBOUND.data.object,
      id: 'AC_redacted_outgoing_call_id',
      to: '+15102055536',
      from: '+18889155797',
      direction: 'outgoing',
      answeredAt: '2026-08-17T10:00:05.000Z',
      completedAt: '2026-08-17T10:00:35.000Z', // 0:30
    },
  },
}

const METADATA = { phoneNumberId: 'PN0eLoM7TQ', phoneNumber: '+18889155797' }
const CONVERSATION_ID = 'CNa71b750b888a4cdd81cd3a1ff0f8c0a9'

const convert = (
  event: QuoWebhookEvent<QuoWebhookCall>,
  conversationId: string | null = CONVERSATION_ID
) => convertQuoWebhookCallEventToMessageData(event, 'int-1', 'org-1', METADATA, conversationId)

describe('convertQuoWebhookCallEventToMessageData', () => {
  describe('answered call', () => {
    it('maps to CALL with the computed duration and answered:true', () => {
      const data = convert(ANSWERED_INBOUND)
      expect(data?.messageType).toBe(MessageType.CALL)
      expect(data?.hasAttachments).toBe(false)
      expect(data?.snippet).toBe('Call (2:13)')

      const callMeta = (data?.metadata as any)?.call
      expect(callMeta.answered).toBe(true)
      expect(callMeta.direction).toBe('incoming')
      expect(callMeta.durationSeconds).toBe(133) // 2:13
      expect(callMeta.answeredAt).toBe('2026-08-17T10:00:05.000Z')
      expect(callMeta.completedAt).toBe('2026-08-17T10:02:18.000Z')
    })

    it('labels an outgoing answered call distinctly and computes duration from its own timestamps', () => {
      const data = convert(OUTGOING_ANSWERED)
      expect(data?.isInbound).toBe(false)
      expect(data?.snippet).toBe('Outgoing call (0:30)')
      expect((data?.metadata as any)?.call.direction).toBe('outgoing')
    })
  })

  describe('missed call, no voicemail', () => {
    it('maps to CALL, answered:false, "Missed call"', () => {
      const data = convert(MISSED_NO_VOICEMAIL)
      expect(data?.messageType).toBe(MessageType.CALL)
      expect(data?.snippet).toBe('Missed call')
      expect(data?.hasAttachments).toBe(false)
      expect((data?.metadata as any)?.call.answered).toBe(false)
      expect((data?.metadata as any)?.call.durationSeconds).toBeNull()
    })
  })

  describe('voicemail', () => {
    it('maps to VOICEMAIL, hasAttachments:true, duration from voicemail.duration', () => {
      const data = convert(VOICEMAIL)
      expect(data?.messageType).toBe(MessageType.VOICEMAIL)
      expect(data?.hasAttachments).toBe(true)
      expect(data?.snippet).toBe('Voicemail (0:42)')
      const callMeta = (data?.metadata as any)?.call
      expect(callMeta.durationSeconds).toBe(42)
      expect(callMeta.answered).toBe(false)
    })

    it('retains the raw event for a future recording/voicemail backfill', () => {
      expect(convert(VOICEMAIL)?.metadata).toEqual({
        call: (convert(VOICEMAIL)?.metadata as any).call,
        quo_webhook_event: VOICEMAIL,
      })
    })
  })

  describe('threading and envelope', () => {
    it('takes the conversation key from the caller, not the payload', () => {
      expect(convert(ANSWERED_INBOUND)?.externalThreadId).toBe(CONVERSATION_ID)
      expect(convert(ANSWERED_INBOUND, null)?.externalThreadId).toBeUndefined()
    })

    it('carries no subject', () => {
      expect(convert(ANSWERED_INBOUND)?.subject).toBeNull()
    })

    it('externalId is the call id', () => {
      expect(convert(ANSWERED_INBOUND)?.externalId).toBe('AC_redacted_call_id')
    })
  })

  describe('unusable payloads return null rather than throwing', () => {
    it('drops an event with no call object', () => {
      expect(
        convertQuoWebhookCallEventToMessageData(
          { ...ANSWERED_INBOUND, data: { object: undefined as never } },
          'int-1',
          'org-1',
          METADATA,
          CONVERSATION_ID
        )
      ).toBeNull()
    })

    it('drops an event with an unparseable createdAt', () => {
      const bad = {
        ...ANSWERED_INBOUND,
        data: {
          ...ANSWERED_INBOUND.data,
          object: { ...ANSWERED_INBOUND.data.object, createdAt: 'not-a-date' },
        },
      }
      expect(convert(bad)).toBeNull()
    })

    it('falls back to our own number for the missing side of the exchange', () => {
      const noTo = {
        ...ANSWERED_INBOUND,
        data: {
          ...ANSWERED_INBOUND.data,
          object: { ...ANSWERED_INBOUND.data.object, to: '' },
        },
      }
      expect(convert(noTo)?.to?.[0]?.identifier).toBe('+18889155797')
    })
  })
})
