// apps/web/src/components/mail/chat-timeline.ts
//
// Interleave admin-side chat messages with thread lifecycle events
// (taken_over, returned_to_ai, archived, reopened, assignee:changed,
// visitor:identified) into a single sorted render list. Consecutive
// same-sender CHAT messages within a 5-minute window collapse into a
// `chat-group`; any event between them breaks the cluster.
//
// Mirrors the widget's `buildTimeline` in
// `apps/chat-widget/src/views/conversation/conversation-view.tsx`, but
// operates on the admin `MessageMeta` shape and emits the same
// `chat-group` / `single` item kinds the existing `thread-messages` and
// `chat-panel/messages` renderers already understand.

import type { MessageMeta } from '~/components/threads/store'
import type { ChatThreadEvent } from './chat-panel/system-line'

const CHAT_GROUP_WINDOW_MS = 5 * 60_000

export type ChatTimelineItem =
  | { kind: 'single'; message: MessageMeta; index: number }
  | { kind: 'chat-group'; messages: MessageMeta[]; startIndex: number; endIndex: number }
  | { kind: 'event'; event: ChatThreadEvent }

/**
 * Interleave messages and thread events by timestamp, collapsing consecutive
 * same-sender CHAT messages into groups. `index` / `startIndex` / `endIndex`
 * point back into the original `messages` array so existing per-message UI
 * (latest-message check, animation delay) keeps working.
 */
export function buildChatTimeline(
  messages: MessageMeta[],
  events: ChatThreadEvent[]
): ChatTimelineItem[] {
  type Entry =
    | { kind: 'message'; createdAt: number; message: MessageMeta; index: number }
    | { kind: 'event'; createdAt: number; event: ChatThreadEvent }

  const entries: Entry[] = [
    ...messages.map((m, i) => ({
      kind: 'message' as const,
      createdAt: messageTimestamp(m),
      message: m,
      index: i,
    })),
    ...events.map((e) => ({
      kind: 'event' as const,
      createdAt: new Date(e.createdAt).getTime(),
      event: e,
    })),
  ]
  // Stable sort: messages tie-break by index so adjacent same-sender items
  // stay adjacent (Array.prototype.sort is stable since ES2019).
  entries.sort((a, b) => a.createdAt - b.createdAt)

  const out: ChatTimelineItem[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.kind === 'event') {
      out.push({ kind: 'event', event: entry.event })
      continue
    }
    if (entry.message.messageType !== 'CHAT') {
      out.push({ kind: 'single', message: entry.message, index: entry.index })
      continue
    }
    const startIndex = entry.index
    let endIndex = entry.index
    const run: MessageMeta[] = [entry.message]
    while (i + 1 < entries.length) {
      const next = entries[i + 1]!
      if (next.kind !== 'message') break
      if (!canGroupChat(run[run.length - 1]!, next.message)) break
      run.push(next.message)
      endIndex = next.index
      i++
    }
    out.push({ kind: 'chat-group', messages: run, startIndex, endIndex })
  }
  return out
}

function messageTimestamp(m: MessageMeta): number {
  if (m.sentAt) return new Date(m.sentAt).getTime()
  return 0
}

function canGroupChat(a: MessageMeta, b: MessageMeta): boolean {
  if (b.messageType !== 'CHAT') return false
  if (a.isInbound !== b.isInbound) return false
  if (fromParticipant(a) !== fromParticipant(b)) return false
  const aT = a.sentAt ? new Date(a.sentAt).getTime() : null
  const bT = b.sentAt ? new Date(b.sentAt).getTime() : null
  if (aT === null || bT === null) return true
  return Math.abs(bT - aT) <= CHAT_GROUP_WINDOW_MS
}

function fromParticipant(m: MessageMeta): string | null {
  return m.participants.find((p) => p.startsWith('from:')) ?? null
}
