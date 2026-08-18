// apps/web/src/components/mail/chat-timeline.ts
//
// Interleave admin-side conversational messages with thread lifecycle events
// (taken_over, returned_to_ai, archived, reopened, assignee:changed,
// visitor:identified) into a single sorted render list. Consecutive
// same-sender bubble messages within a 5-minute window collapse into a
// `chat-group`; any event between them breaks the cluster.
//
// "Bubble message" is `isBubbleMessage` — CHAT *and* SMS/WhatsApp/DM. Gating on
// `messageType === 'CHAT'` is what kept SMS out of the bubble renderer and in
// the email-shaped fallback card.
//
// Mirrors the widget's `buildTimeline` in
// `apps/chat-widget/src/views/conversation/conversation-view.tsx`, but
// operates on the admin `MessageMeta` shape and emits the same
// `chat-group` / `single` item kinds the existing `thread-messages` and
// `chat-panel/messages` renderers already understand.

import type { MessageMeta } from '~/components/threads/store'
import type { ChatThreadEvent } from './chat-panel/system-line'
import { isBubbleMessage } from './utils/message-bubble'

const CHAT_GROUP_WINDOW_MS = 5 * 60_000

/**
 * Window for collapsing consecutive same-actor events into an `event-run`
 * (plans/threads/thread-events.md §13.5, Phase 6) — measured from the run's
 * FIRST event, so a slow drip of changes doesn't chain into one endless run.
 */
export const EVENT_RUN_WINDOW_MS = 5 * 60_000

export type ChatTimelineItem =
  | { kind: 'single'; message: MessageMeta; index: number }
  | { kind: 'chat-group'; messages: MessageMeta[]; startIndex: number; endIndex: number }
  | { kind: 'event'; event: ChatThreadEvent }
  | { kind: 'event-run'; events: ChatThreadEvent[] /* always ≥2 */ }

/**
 * Interleave messages and thread events by timestamp, collapsing consecutive
 * same-sender bubble messages into groups. `index` / `startIndex` / `endIndex`
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
      // Collapse consecutive events (no message between them) by the same
      // actor identity, within EVENT_RUN_WINDOW_MS of the run's start, into
      // one `event-run`. A lone event stays a flat `event` line.
      const run: ChatThreadEvent[] = [entry.event]
      const runStart = entry.createdAt
      const runKey = eventActorKey(entry.event)
      while (i + 1 < entries.length) {
        const next = entries[i + 1]!
        if (next.kind !== 'event') break
        if (eventActorKey(next.event) !== runKey) break
        if (next.createdAt - runStart > EVENT_RUN_WINDOW_MS) break
        run.push(next.event)
        i++
      }
      if (run.length === 1) out.push({ kind: 'event', event: entry.event })
      else out.push({ kind: 'event-run', events: run })
      continue
    }
    if (!isBubbleMessage(entry.message.messageType)) {
      out.push({ kind: 'single', message: entry.message, index: entry.index })
      continue
    }
    const startIndex = entry.index
    let endIndex = entry.index
    const run: MessageMeta[] = [entry.message]
    while (i + 1 < entries.length) {
      const next = entries[i + 1]!
      if (next.kind !== 'message') break
      if (!canGroupBubble(run[run.length - 1]!, next.message)) break
      run.push(next.message)
      endIndex = next.index
      i++
    }
    out.push({ kind: 'chat-group', messages: run, startIndex, endIndex })
  }
  return out
}

/**
 * Actor-identity key for run collapsing: the branded `actorId` when present
 * (falling back to the legacy `data.userId` payload on pre-cut-over rows),
 * else the automation provenance (`source.kind` + `source.id`), else a shared
 * 'system' bucket. Two events collapse only when their keys match.
 */
export function eventActorKey(event: ChatThreadEvent): string {
  if (typeof event.actorId === 'string' && event.actorId) return `actor:${event.actorId}`
  const legacyUserId = event.data?.userId
  if (typeof legacyUserId === 'string' && legacyUserId) return `actor:user:${legacyUserId}`
  const source = event.data?.source
  if (source && typeof source === 'object') {
    const { kind, id } = source as { kind?: unknown; id?: unknown }
    if (typeof kind === 'string') {
      return `source:${kind}:${typeof id === 'string' ? id : ''}`
    }
  }
  return 'system'
}

function messageTimestamp(m: MessageMeta): number {
  // Unsent / in-flight rows (PENDING send, or a stranded send) have no `sentAt`.
  // Falling back to `createdAt` keeps them in chronological position instead of
  // sorting them to the epoch and pinning them to the top of the thread.
  if (m.sentAt) return new Date(m.sentAt).getTime()
  if (m.createdAt) return new Date(m.createdAt).getTime()
  return 0
}

function canGroupBubble(a: MessageMeta, b: MessageMeta): boolean {
  if (!isBubbleMessage(b.messageType)) return false
  // Same transport only. One channel per thread makes a mixed run unlikely, but
  // `openphone` alone emits SMS and CALL, and a merged stack of two different
  // message shapes would render as one conversation turn.
  if (a.messageType !== b.messageType) return false
  if (a.isInbound !== b.isInbound) return false
  if (fromParticipant(a) !== fromParticipant(b)) return false
  const aT = messageTimestamp(a) || null
  const bT = messageTimestamp(b) || null
  if (aT === null || bT === null) return true
  return Math.abs(bT - aT) <= CHAT_GROUP_WINDOW_MS
}

function fromParticipant(m: MessageMeta): string | null {
  return m.participants.find((p) => p.startsWith('from:')) ?? null
}
