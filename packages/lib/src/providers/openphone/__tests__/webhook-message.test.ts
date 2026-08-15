// packages/lib/src/providers/openphone/__tests__/webhook-message.test.ts

import { describe, expect, it } from 'vitest'
import type { QuoWebhookEvent, QuoWebhookMessage } from '../types'
import { convertQuoWebhookEventToMessageData } from '../webhook-message'

/**
 * CAPTURED FROM A LIVE EVENT, not written from the docs.
 *
 * Copied out of `Message.metadata.quo_webhook_event` after the first real two-way SMS on
 * `+18889155797` (2026-08-15, `apiVersion: "v4"`). Every previous wire bug on this channel —
 * `body` vs `text`, a `conversationId` that does not exist — passed a fixture written from the
 * documentation, so the rule for this file is: **change it only by pasting a newer captured
 * payload.** Do not add fields the docs promise and the wire has never sent.
 *
 * ONE deviation from the capture: the `AC…` message ids are redacted. Quo runs on Twilio, so its
 * message ids are `AC` + 32 hex — the same shape as a Twilio Account SID, which GitHub's push
 * protection blocks. None of them is a credential (they are opaque per-message identifiers on a
 * dev workspace); the redaction only keeps this file pushable. Every field the mapper reads is
 * verbatim. When pasting a newer payload, redact those ids the same way.
 */
const LIVE_INBOUND: QuoWebhookEvent<QuoWebhookMessage> = {
  id: 'EVea4c92a952ff4899b14a621209459f97',
  object: 'event',
  apiVersion: 'v4',
  createdAt: '2026-08-15T07:01:22.731Z',
  type: 'message.received',
  data: {
    object: {
      id: 'AC_redacted_inbound_msg_id',
      object: 'message',
      to: '+18889155797',
      from: '+15102055536',
      text: 'Ok',
      media: [],
      status: 'received',
      userId: 'USLPYvl8qp',
      createdAt: '2026-08-15T07:01:22.271Z',
      direction: 'incoming',
      contactIds: ['677dd3e7cbf01ca406b05b63', '677ddaa3a1630c58da0da45f'],
      phoneNumberId: 'PN0eLoM7TQ',
    },
    deepLink:
      'https://my.quo.com/inbox/PN0eLoM7TQ/c/CNa71b750b888a4cdd81cd3a1ff0f8c0a9?at=AC_redacted_inbound_msg_id',
  },
}

const LIVE_OUTBOUND_ECHO: QuoWebhookEvent<QuoWebhookMessage> = {
  ...LIVE_INBOUND,
  id: 'EV918c16bd83ac4fab8fe4325670092886',
  type: 'message.delivered',
  data: {
    ...LIVE_INBOUND.data,
    object: {
      ...LIVE_INBOUND.data.object,
      id: 'AC_redacted_outbound_msg_id',
      to: '+15102055536',
      from: '+18889155797',
      text: 'test',
      status: 'delivered',
      direction: 'outgoing',
    },
  },
}

const METADATA = { phoneNumberId: 'PN0eLoM7TQ', phoneNumber: '+18889155797' }
const CONVERSATION_ID = 'CNa71b750b888a4cdd81cd3a1ff0f8c0a9'

const convert = (
  event: QuoWebhookEvent<QuoWebhookMessage>,
  conversationId: string | null = CONVERSATION_ID
) => convertQuoWebhookEventToMessageData(event, 'int-1', 'org-1', METADATA, conversationId)

describe('convertQuoWebhookEventToMessageData', () => {
  describe('body text', () => {
    it('reads the body from `text`', () => {
      // The regression. Reading `body` — what the docs and our old type declared — yielded
      // `undefined`, stored `''`, and rendered every inbound SMS as "No content".
      expect(convert(LIVE_INBOUND)?.textPlain).toBe('Ok')
      expect(convert(LIVE_INBOUND)?.snippet).toBe('Ok')
    })

    it('never reads a `body` field', () => {
      // A payload carrying BOTH must still take `text`. This fails if anyone reintroduces a
      // `message.body ?? message.text` tolerance, which would let the next wire change pass
      // silently all over again.
      const withBogusBody = {
        ...LIVE_INBOUND,
        data: {
          ...LIVE_INBOUND.data,
          object: { ...LIVE_INBOUND.data.object, body: 'WRONG' } as QuoWebhookMessage,
        },
      }
      expect(convert(withBogusBody)?.textPlain).toBe('Ok')
    })
  })

  describe('threading', () => {
    it('takes the conversation key from the caller, not the payload', () => {
      // The payload has no `conversationId` at all — that is the point.
      expect('conversationId' in LIVE_INBOUND.data.object).toBe(false)
      expect(convert(LIVE_INBOUND)?.externalThreadId).toBe(CONVERSATION_ID)
    })

    it('leaves externalThreadId undefined when the key could not be recovered', () => {
      // Un-threadable, and honest about it: the message still stores, it just opens its own
      // thread. Better than inventing a key that will never match the real one.
      expect(convert(LIVE_INBOUND, null)?.externalThreadId).toBeUndefined()
    })
  })

  describe('direction and envelope', () => {
    it('maps an inbound message', () => {
      const data = convert(LIVE_INBOUND)
      expect(data?.isInbound).toBe(true)
      expect(data?.from.identifier).toBe('+15102055536')
      expect(data?.to?.[0]?.identifier).toBe('+18889155797')
      expect(data?.externalId).toBe('AC_redacted_inbound_msg_id')
    })

    it('maps the outbound delivery echo', () => {
      // `direction: 'outgoing'`, not 'outbound' — another docs-vs-wire trap.
      const data = convert(LIVE_OUTBOUND_ECHO)
      expect(data?.isInbound).toBe(false)
      expect(data?.from.identifier).toBe('+18889155797')
      expect(data?.to?.[0]?.identifier).toBe('+15102055536')
      expect(data?.textPlain).toBe('test')
    })

    it('carries no subject — SMS has none', () => {
      expect(convert(LIVE_INBOUND)?.subject).toBeUndefined()
    })

    it('never claims attachments, even with media on the payload', () => {
      // `hasAttachments: true` fires attachment workflow rules for bytes we never fetched.
      const withMedia = {
        ...LIVE_INBOUND,
        data: {
          ...LIVE_INBOUND.data,
          object: {
            ...LIVE_INBOUND.data.object,
            media: [{ url: 'https://example.com/a.jpg', type: 'image/jpeg' }],
          },
        },
      }
      expect(convert(withMedia)?.hasAttachments).toBe(false)
    })

    it('retains the raw event for a future backfill', () => {
      expect(convert(LIVE_INBOUND)?.metadata).toEqual({ quo_webhook_event: LIVE_INBOUND })
    })
  })

  describe('unusable payloads return null rather than throwing', () => {
    it('drops an event with no message object', () => {
      expect(
        convertQuoWebhookEventToMessageData(
          { ...LIVE_INBOUND, data: { object: undefined as never } },
          'int-1',
          'org-1',
          METADATA,
          CONVERSATION_ID
        )
      ).toBeNull()
    })

    it('drops an event with an unparseable createdAt', () => {
      const bad = {
        ...LIVE_INBOUND,
        data: {
          ...LIVE_INBOUND.data,
          object: { ...LIVE_INBOUND.data.object, createdAt: 'not-a-date' },
        },
      }
      expect(convert(bad)).toBeNull()
    })

    it('falls back to our own number for the missing side of the exchange', () => {
      const noTo = {
        ...LIVE_INBOUND,
        data: {
          ...LIVE_INBOUND.data,
          object: { ...LIVE_INBOUND.data.object, to: '' },
        },
      }
      expect(convert(noTo)?.to?.[0]?.identifier).toBe('+18889155797')
    })
  })
})
