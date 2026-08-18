// apps/web/src/components/mail/chat-timeline.test.ts
//
// The grouping gate used to be `messageType === 'CHAT'`, which is why every SMS
// message fell through to `single` and rendered in the email-shaped fallback
// card while chat got bubbles. These lock in the widened gate.

import type { ParticipantId } from '@auxx/types'
import { describe, expect, it } from 'vitest'
import type { MessageMeta, MessageType } from '~/components/threads/store'
import type { ChatThreadEvent } from './chat-panel/system-line'
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

  it('keeps CHAT and SMS messages on the bubble path', () => {
    for (const messageType of ['CHAT', 'SMS'] as const) {
      const items = buildChatTimeline([message('m1', { messageType })], [])
      expect(items[0]?.kind, messageType).toBe('chat-group')
    }
  })

  it('never bubbles CALL or VOICEMAIL', () => {
    for (const messageType of ['CALL', 'VOICEMAIL'] as const) {
      const items = buildChatTimeline([message('m1', { messageType })], [])
      expect(items[0], messageType).toMatchObject({ kind: 'single', index: 0 })
    }
  })
})

function event(id: string, overrides: Partial<ChatThreadEvent> = {}): ChatThreadEvent {
  return {
    id,
    type: 'thread:archived',
    createdAt: '2026-08-17T10:00:00.000Z',
    actorId: 'user:u1',
    data: {},
    ...overrides,
  }
}

describe('buildChatTimeline event runs', () => {
  it('keeps a single event as a flat event item', () => {
    const items = buildChatTimeline([], [event('e1')])
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('event')
  })

  it('collapses consecutive same-actor events within the window into one run', () => {
    const items = buildChatTimeline(
      [],
      [
        event('e1', { createdAt: '2026-08-17T10:00:00.000Z' }),
        event('e2', { type: 'thread:tagged', createdAt: '2026-08-17T10:01:00.000Z' }),
        event('e3', { type: 'thread:reopened', createdAt: '2026-08-17T10:02:00.000Z' }),
      ]
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'event-run' })
    expect(items[0]?.kind === 'event-run' && items[0].events.map((e) => e.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ])
  })

  it('splits a run when the actor identity changes', () => {
    const items = buildChatTimeline(
      [],
      [
        event('e1', { createdAt: '2026-08-17T10:00:00.000Z' }),
        event('e2', { actorId: 'user:u2', createdAt: '2026-08-17T10:01:00.000Z' }),
      ]
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.kind)).toEqual(['event', 'event'])
  })

  it('collapses null-actor events sharing the same source kind + id', () => {
    const source = { kind: 'workflow', id: 'wf1' }
    const items = buildChatTimeline(
      [],
      [
        event('e1', { actorId: null, data: { source }, createdAt: '2026-08-17T10:00:00.000Z' }),
        event('e2', { actorId: null, data: { source }, createdAt: '2026-08-17T10:01:00.000Z' }),
      ]
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('event-run')
  })

  it('splits null-actor events with different source ids', () => {
    const items = buildChatTimeline(
      [],
      [
        event('e1', {
          actorId: null,
          data: { source: { kind: 'workflow', id: 'wf1' } },
          createdAt: '2026-08-17T10:00:00.000Z',
        }),
        event('e2', {
          actorId: null,
          data: { source: { kind: 'workflow', id: 'wf2' } },
          createdAt: '2026-08-17T10:01:00.000Z',
        }),
      ]
    )
    expect(items).toHaveLength(2)
  })

  it('splits when an event falls outside the 5-minute window from the run start', () => {
    const items = buildChatTimeline(
      [],
      [
        event('e1', { createdAt: '2026-08-17T10:00:00.000Z' }),
        event('e2', { createdAt: '2026-08-17T10:04:00.000Z' }),
        // 6 min after e1 (the run START), though only 2 min after e2.
        event('e3', { createdAt: '2026-08-17T10:06:00.000Z' }),
      ]
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'event-run' })
    expect(items[1]?.kind).toBe('event')
  })

  it('breaks a run when a message lands between the events', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: '2026-08-17T10:01:00.000Z' })],
      [
        event('e1', { createdAt: '2026-08-17T10:00:00.000Z' }),
        event('e2', { createdAt: '2026-08-17T10:02:00.000Z' }),
      ]
    )
    expect(items.map((i) => i.kind)).toEqual(['event', 'chat-group', 'event'])
  })

  it('preserves ASC ordering across messages, events and runs', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: '2026-08-17T10:05:00.000Z' })],
      [
        event('e1', { createdAt: '2026-08-17T10:00:00.000Z' }),
        event('e2', { createdAt: '2026-08-17T10:01:00.000Z' }),
        event('e3', { createdAt: '2026-08-17T10:10:00.000Z' }),
      ]
    )
    expect(items.map((i) => i.kind)).toEqual(['event-run', 'chat-group', 'event'])
  })
})
