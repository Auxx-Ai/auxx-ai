// apps/web/src/components/mail/chat-timeline.test.ts
//
// The grouping gate used to be `messageType === 'CHAT'`, which is why every SMS
// message fell through to `single` and rendered in the email-shaped fallback
// card while chat got bubbles. These lock in the widened gate.

import type { ParticipantId } from '@auxx/types'
import { describe, expect, it } from 'vitest'
import type { MessageMeta, MessageType } from '~/components/threads/store'
import { buildChatTimeline } from './chat-timeline'

function message(
  id: string,
  overrides: Partial<MessageMeta> & { messageType: MessageType }
): MessageMeta {
  return {
    id,
    threadId: 't1',
    subject: null,
    snippet: null,
    textHtml: null,
    textPlain: `body ${id}`,
    isInbound: true,
    isFirstInThread: false,
    hasAttachments: false,
    hasHtmlBody: false,
    hasTextBody: true,
    sentAt: '2026-08-17T10:00:00.000Z',
    receivedAt: null,
    createdAt: '2026-08-17T10:00:00.000Z',
    participants: ['from:p1' as ParticipantId],
    createdById: null,
    sendStatus: null,
    providerError: null,
    attempts: 0,
    attachments: [],
    ...overrides,
  }
}

describe('buildChatTimeline', () => {
  it('bubbles a lone SMS instead of dropping it to the fallback card', () => {
    const items = buildChatTimeline([message('m1', { messageType: 'SMS' })], [])
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('chat-group')
  })

  it('clusters consecutive same-sender SMS inside the 5-minute window', () => {
    const items = buildChatTimeline(
      [
        message('m1', { messageType: 'SMS', sentAt: '2026-08-17T10:00:00.000Z' }),
        message('m2', { messageType: 'SMS', sentAt: '2026-08-17T10:02:00.000Z' }),
      ],
      []
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'chat-group', startIndex: 0, endIndex: 1 })
  })

  it('breaks a cluster when the direction flips', () => {
    const items = buildChatTimeline(
      [
        message('m1', { messageType: 'SMS' }),
        message('m2', { messageType: 'SMS', isInbound: false }),
      ],
      []
    )
    expect(items).toHaveLength(2)
  })

  it('never groups across transports', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'SMS' }), message('m2', { messageType: 'CHAT' })],
      []
    )
    expect(items).toHaveLength(2)
  })

  it('leaves email as a single so EmailDisplay still renders it', () => {
    const items = buildChatTimeline([message('m1', { messageType: 'EMAIL' })], [])
    expect(items[0]).toMatchObject({ kind: 'single', index: 0 })
  })

  it('keeps WhatsApp and DM messages on the bubble path', () => {
    for (const messageType of ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM'] as const) {
      const items = buildChatTimeline([message('m1', { messageType })], [])
      expect(items[0]?.kind, messageType).toBe('chat-group')
    }
  })
})
