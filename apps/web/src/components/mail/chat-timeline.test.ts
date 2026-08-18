// apps/web/src/components/mail/chat-timeline.test.ts
//
// The grouping gate used to be `messageType === 'CHAT'`, which is why every SMS
// message fell through to `single` and rendered in the email-shaped fallback
// card while chat got bubbles. These lock in the widened gate.
//
// v2 (plans/threads/thread-events.md §15): `buildChatTimeline` now also emits
// `day-separator` items across the WHOLE timeline and folds events into
// `event-block`s (retiring `event` / `event-run` + same-actor run keying). Most
// of the pre-existing message-grouping tests below strip the leading
// day-separator via `withoutSeparators` so they keep testing chat-group
// behavior in isolation; day-separator placement/labeling and block
// segmentation get their own describe blocks.
//
// All timestamps go through `localIso` (a LOCAL Date constructor, not a raw
// UTC ISO literal) so "same calendar day" / "crosses midnight" assertions are
// correct under whatever timezone the test runner uses — a UTC-literal
// "23:58Z" → "00:01Z" pair does NOT cross a local midnight in every zone.

import type { ParticipantId } from '@auxx/types'
import { describe, expect, it } from 'vitest'
import type { MessageMeta, MessageType } from '~/components/threads/store'
import type { ChatThreadEvent } from './chat-panel/system-line'
import {
  buildChatTimeline,
  type ChatTimelineItem,
  composeEventGroupSummary,
  formatEventGroupSummary,
} from './chat-timeline'

/** Local-time constructor → ISO string, so day-boundary math is TZ-independent. */
function localIso(y: number, m: number, d: number, h = 10, mi = 0): string {
  return new Date(y, m - 1, d, h, mi, 0, 0).toISOString()
}

/** Pin "now" to 2026-08-17 (a Monday), local time, for deterministic day labels. */
const NOW = new Date(2026, 7, 17, 20, 0, 0)

function withoutSeparators(items: ChatTimelineItem[]): ChatTimelineItem[] {
  return items.filter((i) => i.kind !== 'day-separator')
}

function message(
  id: string,
  overrides: Partial<MessageMeta> & { messageType: MessageType }
): MessageMeta {
  const defaultSentAt = localIso(2026, 8, 17, 10, 0)
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
    sentAt: defaultSentAt,
    receivedAt: null,
    createdAt: defaultSentAt,
    participants: ['from:p1' as ParticipantId],
    createdById: null,
    sendStatus: null,
    providerError: null,
    attempts: 0,
    attachments: [],
    ...overrides,
  }
}

function event(id: string, overrides: Partial<ChatThreadEvent> = {}): ChatThreadEvent {
  return {
    id,
    type: 'thread:archived',
    createdAt: localIso(2026, 8, 17, 10, 0),
    actorId: 'user:u1',
    data: {},
    ...overrides,
  }
}

describe('buildChatTimeline — bubble grouping', () => {
  it('bubbles a lone SMS instead of dropping it to the fallback card', () => {
    const items = withoutSeparators(
      buildChatTimeline([message('m1', { messageType: 'SMS' })], [], { now: NOW })
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('chat-group')
  })

  it('clusters consecutive same-sender SMS inside the 5-minute window', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [
          message('m1', { messageType: 'SMS', sentAt: localIso(2026, 8, 17, 10, 0) }),
          message('m2', { messageType: 'SMS', sentAt: localIso(2026, 8, 17, 10, 2) }),
        ],
        [],
        { now: NOW }
      )
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'chat-group', startIndex: 0, endIndex: 1 })
  })

  it('breaks a cluster when the direction flips', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [
          message('m1', { messageType: 'SMS' }),
          message('m2', { messageType: 'SMS', isInbound: false }),
        ],
        [],
        { now: NOW }
      )
    )
    expect(items).toHaveLength(2)
  })

  it('never groups across transports', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [message('m1', { messageType: 'SMS' }), message('m2', { messageType: 'CHAT' })],
        [],
        { now: NOW }
      )
    )
    expect(items).toHaveLength(2)
  })

  it('leaves email as a single so EmailDisplay still renders it', () => {
    const items = withoutSeparators(
      buildChatTimeline([message('m1', { messageType: 'EMAIL' })], [], { now: NOW })
    )
    expect(items[0]).toMatchObject({ kind: 'single', index: 0 })
  })

  it('keeps CHAT and SMS messages on the bubble path', () => {
    for (const messageType of ['CHAT', 'SMS'] as const) {
      const items = withoutSeparators(
        buildChatTimeline([message('m1', { messageType })], [], { now: NOW })
      )
      expect(items[0]?.kind, messageType).toBe('chat-group')
    }
  })

  it('never bubbles CALL or VOICEMAIL', () => {
    for (const messageType of ['CALL', 'VOICEMAIL'] as const) {
      const items = withoutSeparators(
        buildChatTimeline([message('m1', { messageType })], [], { now: NOW })
      )
      expect(items[0], messageType).toMatchObject({ kind: 'single', index: 0 })
    }
  })

  it('splits a chat-group across a day boundary', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [
          message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 16, 23, 58) }),
          message('m2', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 0, 1) }),
        ],
        [],
        { now: NOW }
      )
    )
    // Same sender, 3 minutes apart (within CHAT_GROUP_WINDOW_MS) — but the day
    // flips, so this must NOT collapse into one chat-group.
    expect(items.map((i) => i.kind)).toEqual(['chat-group', 'chat-group'])
  })
})

describe('buildChatTimeline — day separators (§15.6)', () => {
  it('emits a leading separator even for a single-day timeline', () => {
    const items = buildChatTimeline([message('m1', { messageType: 'CHAT' })], [], { now: NOW })
    expect(items[0]).toMatchObject({ kind: 'day-separator' })
    expect(items).toHaveLength(2)
  })

  it('labels the current day "Today"', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 10, 0) })],
      [],
      { now: NOW }
    )
    expect(items[0]).toMatchObject({ kind: 'day-separator', label: 'Today' })
  })

  it('labels the prior day "Yesterday"', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 16, 10, 0) })],
      [],
      { now: NOW }
    )
    expect(items[0]).toMatchObject({ kind: 'day-separator', label: 'Yesterday' })
  })

  it('labels 2–6 days ago with the weekday name', () => {
    // 2026-08-17 is a Monday; 3 days back is 2026-08-14, a Friday.
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 14, 10, 0) })],
      [],
      { now: NOW }
    )
    expect(items[0]).toMatchObject({ kind: 'day-separator', label: 'Friday' })
  })

  it('labels 7+ days ago with the short date, no year when current', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 1, 10, 0) })],
      [],
      { now: NOW }
    )
    expect(items[0]).toMatchObject({ kind: 'day-separator', label: 'Aug 1' })
  })

  it('appends the year when it differs from the current year', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2025, 8, 1, 10, 0) })],
      [],
      { now: NOW }
    )
    expect(items[0]).toMatchObject({ kind: 'day-separator', label: 'Aug 1, 2025' })
  })

  it('splices one separator between two messages on different days, none for a same-day run', () => {
    const items = buildChatTimeline(
      [
        message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 16, 10, 0) }),
        message('m2', {
          messageType: 'CHAT',
          sentAt: localIso(2026, 8, 16, 10, 5),
          isInbound: false,
        }),
        message('m3', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 9, 0) }),
      ],
      [],
      { now: NOW }
    )
    expect(items.map((i) => i.kind)).toEqual([
      'day-separator',
      'chat-group',
      'chat-group',
      'day-separator',
      'chat-group',
    ])
    expect(items[0]).toMatchObject({ label: 'Yesterday' })
    expect(items[3]).toMatchObject({ label: 'Today' })
  })

  it('shares one day spine across messages and events', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 9, 0) })],
      [event('e1', { createdAt: localIso(2026, 8, 16, 10, 0) })],
      { now: NOW }
    )
    expect(items.map((i) => i.kind)).toEqual([
      'day-separator',
      'event-block',
      'day-separator',
      'chat-group',
    ])
  })
})

describe('buildChatTimeline — event blocks (§15.2/§15.4)', () => {
  it('folds a lone event into a single-entry block', () => {
    const items = withoutSeparators(buildChatTimeline([], [event('e1')], { now: NOW }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'event-block' })
    const block = items[0]!
    if (block.kind !== 'event-block') throw new Error('expected event-block')
    expect(block.entries).toEqual([
      { kind: 'single', event: expect.objectContaining({ id: 'e1' }) },
    ])
  })

  it('keeps 1–2 contiguous events as singles inside the block', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [],
        [
          event('e1', { createdAt: localIso(2026, 8, 17, 10, 0) }),
          event('e2', { type: 'thread:tagged', createdAt: localIso(2026, 8, 17, 10, 1) }),
        ],
        { now: NOW }
      )
    )
    expect(items).toHaveLength(1)
    const block = items[0]!
    if (block.kind !== 'event-block') throw new Error('expected event-block')
    expect(block.entries).toHaveLength(2)
    expect(block.entries.every((e) => e.kind === 'single')).toBe(true)
  })

  it('collapses ≥3 contiguous same-day events into one group, mixed actors welcome', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [],
        [
          event('e1', { actorId: 'user:u1', createdAt: localIso(2026, 8, 17, 10, 0) }),
          event('e2', {
            type: 'thread:tagged',
            actorId: 'user:u2',
            createdAt: localIso(2026, 8, 17, 10, 1),
          }),
          event('e3', {
            type: 'thread:reopened',
            actorId: null,
            createdAt: localIso(2026, 8, 17, 10, 2),
          }),
        ],
        { now: NOW }
      )
    )
    expect(items).toHaveLength(1)
    const block = items[0]!
    if (block.kind !== 'event-block') throw new Error('expected event-block')
    expect(block.entries).toHaveLength(1)
    expect(block.entries[0]!.kind).toBe('group')
    expect(block.entries[0]!.kind === 'group' && block.entries[0].events.map((e) => e.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ])
  })

  it('never groups just 2 events, however close together', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [],
        [
          event('e1', { createdAt: localIso(2026, 8, 17, 10, 0) }),
          event('e2', { createdAt: localIso(2026, 8, 17, 10, 1) }),
        ],
        { now: NOW }
      )
    )
    const block = items[0]!
    if (block.kind !== 'event-block') throw new Error('expected event-block')
    expect(block.entries.every((e) => e.kind === 'single')).toBe(true)
  })

  it('breaks a block when a message lands between events', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 10, 1) })],
        [
          event('e1', { createdAt: localIso(2026, 8, 17, 10, 0) }),
          event('e2', { createdAt: localIso(2026, 8, 17, 10, 2) }),
        ],
        { now: NOW }
      )
    )
    expect(items.map((i) => i.kind)).toEqual(['event-block', 'chat-group', 'event-block'])
  })

  it('splits a block at a day boundary even with no message between', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [],
        [
          event('e1', { createdAt: localIso(2026, 8, 16, 23, 58) }),
          event('e2', { createdAt: localIso(2026, 8, 16, 23, 59) }),
          event('e3', { createdAt: localIso(2026, 8, 17, 0, 1) }),
        ],
        { now: NOW }
      )
    )
    expect(items.map((i) => i.kind)).toEqual(['event-block', 'event-block'])
    const [first, second] = items as Extract<ChatTimelineItem, { kind: 'event-block' }>[]
    expect(first!.entries.every((e) => e.kind === 'single')).toBe(true)
    expect(first!.entries).toHaveLength(2)
    expect(second!.entries).toHaveLength(1)
  })

  it('marks a block trailing when it falls entirely after the last message', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 9, 0) })],
      [event('e1', { createdAt: localIso(2026, 8, 17, 10, 0) })],
      { now: NOW }
    )
    const block = items.find((i) => i.kind === 'event-block')
    expect(block).toMatchObject({ isTrailing: true })
  })

  it('marks a block NOT trailing when a message follows it', () => {
    const items = buildChatTimeline(
      [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 11, 0) })],
      [event('e1', { createdAt: localIso(2026, 8, 17, 10, 0) })],
      { now: NOW }
    )
    const block = items.find((i) => i.kind === 'event-block')
    expect(block).toMatchObject({ isTrailing: false })
  })

  it('preserves ASC ordering across messages, events and blocks', () => {
    const items = withoutSeparators(
      buildChatTimeline(
        [message('m1', { messageType: 'CHAT', sentAt: localIso(2026, 8, 17, 10, 5) })],
        [
          event('e1', { createdAt: localIso(2026, 8, 17, 10, 0) }),
          event('e2', { createdAt: localIso(2026, 8, 17, 10, 1) }),
          event('e3', { createdAt: localIso(2026, 8, 17, 10, 10) }),
        ],
        { now: NOW }
      )
    )
    expect(items.map((i) => i.kind)).toEqual(['event-block', 'chat-group', 'event-block'])
  })
})

describe('composeEventGroupSummary (§15.5)', () => {
  const label = (actorKey: string) => {
    if (actorKey === 'actor:user:u1') return 'Markus'
    if (actorKey === 'actor:user:u2') return 'Lena'
    if (actorKey.startsWith('source:')) return 'Auto-close'
    return 'Someone'
  }

  it('folds repeated tag events by the same actor into one union fragment', () => {
    const events = [
      event('e1', {
        type: 'thread:tagged',
        actorId: 'user:u1',
        data: { tagIds: ['tag:a'], tagNames: ['VIP'] },
      }),
      event('e2', {
        type: 'thread:tagged',
        actorId: 'user:u1',
        data: { tagIds: ['tag:b'], tagNames: ['Urgent'] },
      }),
      event('e3', { type: 'thread:reopened', actorId: 'user:u1' }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.count).toBe(3)
    expect(summary.fragments).toHaveLength(1)
    expect(summary.fragments[0]).toContain('Markus')
    expect(summary.fragments[0]).toContain('VIP')
    expect(summary.fragments[0]).toContain('Urgent')
    expect(summary.fragments[0]).toContain('reopened the conversation')
  })

  it('folds repeated assignee changes to only the final assignee', () => {
    const events = [
      event('e1', {
        type: 'thread:assignee:changed',
        actorId: 'user:u1',
        data: { assigneeActorId: 'user:u2' },
      }),
      event('e2', {
        type: 'thread:assignee:changed',
        actorId: 'user:u1',
        data: { assigneeActorId: 'user:u1' },
      }),
      event('e3', {
        type: 'thread:assignee:changed',
        actorId: 'user:u1',
        data: { assigneeActorId: 'user:u2' },
      }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.fragments).toHaveLength(1)
    expect(summary.fragments[0]).toBe('Markus assigned to Lena')
  })

  it('cancels archived→reopened→archived by the same actor to the final state', () => {
    const events = [
      event('e1', { type: 'thread:archived', actorId: 'user:u1' }),
      event('e2', { type: 'thread:reopened', actorId: 'user:u1' }),
      event('e3', { type: 'thread:archived', actorId: 'user:u1' }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.fragments).toEqual(['Markus marked as done'])
  })

  it('cancels tagged then untagged of the same tag to nothing', () => {
    const events = [
      event('e1', {
        type: 'thread:tagged',
        actorId: 'user:u1',
        data: { tagIds: ['tag:a'], tagNames: ['VIP'] },
      }),
      event('e2', {
        type: 'thread:untagged',
        actorId: 'user:u1',
        data: { tagIds: ['tag:a'], tagNames: ['VIP'] },
      }),
      event('e3', { type: 'thread:visitor:identified', actorId: null }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.fragments).toEqual([])
    expect(summary.count).toBe(3)
  })

  it('does not cancel archived/reopened across DIFFERENT actors', () => {
    // Auto-close archives, then a human reopens — these are two independent
    // actor bundles, not a toggle pair, so both survive as fragments.
    const events = [
      event('e1', {
        type: 'thread:archived',
        actorId: null,
        data: { source: { kind: 'workflow', id: 'wf1', name: 'Auto-close' } },
      }),
      event('e2', { type: 'thread:reopened', actorId: 'user:u1' }),
      event('e3', {
        type: 'thread:tagged',
        actorId: 'user:u1',
        data: { tagIds: ['tag:a'], tagNames: ['VIP'] },
      }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.fragments).toHaveLength(2)
    expect(summary.fragments[0]).toContain('Auto-close')
    expect(summary.fragments[0]).toContain('marked as done')
    expect(summary.fragments[1]).toContain('Markus')
    expect(summary.fragments[1]).toContain('reopened the conversation')
    expect(summary.fragments[1]).toContain('tagged with VIP')
  })

  it('ranks merged above taken_over/returned_to_ai above archived/reopened above assignee above tags', () => {
    const events = [
      event('e1', {
        type: 'thread:tagged',
        actorId: 'user:u1',
        data: { tagIds: ['tag:a'], tagNames: ['VIP'] },
      }),
      event('e2', { type: 'thread:archived', actorId: 'user:u2' }),
      event('e3', { type: 'thread:merged', actorId: null, data: { source: { kind: 'system' } } }),
      event('e4', { type: 'thread:taken_over', actorId: 'user:u1' }),
    ]
    const summary = composeEventGroupSummary(events, label)
    // Only the top 2 ranked bundles survive: the merge (tier 0) and u1's
    // bundle (tier 1, since taken_over outranks u1's own tier-4 tag action) —
    // u2's lone archive (tier 2) is dropped.
    expect(summary.fragments).toHaveLength(2)
    expect(summary.fragments[0]).toContain('merged a conversation into this one')
    expect(summary.fragments[1]).toContain('Markus')
    expect(summary.fragments[1]).toContain('took over the conversation')
  })

  it('non-composable visitor:identified events count toward N without a fragment', () => {
    const events = [
      event('e1', { type: 'thread:visitor:identified', actorId: null }),
      event('e2', { type: 'thread:visitor:identified', actorId: null }),
      event('e3', { type: 'thread:visitor:identified', actorId: null }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.fragments).toEqual([])
    expect(summary.count).toBe(3)
  })

  it('always shows the count even when fragments survive', () => {
    const events = [
      event('e1', { type: 'thread:archived', actorId: 'user:u1' }),
      event('e2', { type: 'thread:visitor:identified', actorId: null }),
      event('e3', { type: 'thread:visitor:identified', actorId: null }),
    ]
    const summary = composeEventGroupSummary(events, label)
    expect(summary.count).toBe(3)
    expect(formatEventGroupSummary(summary)).toBe('Markus marked as done · 3 updates')
  })
})

describe('formatEventGroupSummary', () => {
  it('renders count-only when nothing survives cancellation', () => {
    expect(formatEventGroupSummary({ fragments: [], count: 4 })).toBe('4 updates')
  })

  it('singularizes a count of 1', () => {
    expect(formatEventGroupSummary({ fragments: [], count: 1 })).toBe('1 update')
  })

  it('joins two fragments with Intl.ListFormat, not a hand-rolled separator', () => {
    const text = formatEventGroupSummary({
      fragments: ['Auto-close archived', 'Markus reopened'],
      count: 6,
    })
    expect(text).toBe(
      `${new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format([
        'Auto-close archived',
        'Markus reopened',
      ])} · 6 updates`
    )
  })
})
