// apps/web/src/components/mail/chat-timeline.ts
//
// Interleave admin-side conversational messages with thread lifecycle events
// (taken_over, returned_to_ai, archived, reopened, assignee:changed,
// visitor:identified, tagged, untagged, merged) into a single sorted render
// list, plus viewer-local day separators across the whole conversation
// (plans/threads/thread-events.md §15, "Timeline UI v2").
//
// "Bubble message" is `isBubbleMessage` — CHAT *and* SMS/WhatsApp/DM. Gating on
// `messageType === 'CHAT'` is what kept SMS out of the bubble renderer and in
// the email-shaped fallback card.
//
// v2 retires the `event` / `event-run` item kinds and same-actor run keying
// (§13.5/Phase 6, superseded). Every contiguous stretch of events between two
// messages — bounded also by a day boundary — becomes one `event-block`; day
// separators (`day-separator`) are emitted across messages AND events so both
// share one day spine, and chat-group coalescing never spans one either.

import type { ThreadEventType } from '@auxx/lib/thread-events/client'
import type { MessageMeta } from '~/components/threads/store'
import type { ChatThreadEvent } from './chat-panel/system-line'
import { isBubbleMessage } from './utils/message-bubble'

const CHAT_GROUP_WINDOW_MS = 5 * 60_000

/** A single event row, or ≥3 contiguous same-day events collapsed into one group-row. */
export type EventBlockEntry =
  | { kind: 'single'; event: ChatThreadEvent }
  | { kind: 'group'; events: ChatThreadEvent[] /* always ≥3 */ }

export type ChatTimelineItem =
  | { kind: 'single'; message: MessageMeta; index: number }
  | { kind: 'chat-group'; messages: MessageMeta[]; startIndex: number; endIndex: number }
  | { kind: 'day-separator'; key: string; label: string }
  | {
      kind: 'event-block'
      key: string
      entries: EventBlockEntry[]
      /**
       * True when every event in this block falls after the thread's last
       * message — the thread's current tail state. Trailing blocks render
       * expanded initially (§15.4.3); earlier blocks start collapsed.
       */
      isTrailing: boolean
    }

/**
 * Interleave messages and thread events by timestamp, collapsing consecutive
 * same-sender bubble messages into `chat-group`s and consecutive events (no
 * message between them) into `event-block`s, with viewer-local day separators
 * spliced across the whole list. `index` / `startIndex` / `endIndex` point back
 * into the original `messages` array so existing per-message UI (latest-message
 * check, animation delay) keeps working.
 *
 * @param now Reference instant for "Today" / "Yesterday" labeling — defaults to
 * the real clock; tests pin it for deterministic labels.
 */
export function buildChatTimeline(
  messages: MessageMeta[],
  events: ChatThreadEvent[],
  options?: { now?: Date }
): ChatTimelineItem[] {
  const now = options?.now ?? new Date()

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

  const lastMessageTs =
    messages.length > 0
      ? Math.max(...messages.map((m) => messageTimestamp(m)))
      : Number.NEGATIVE_INFINITY

  const out: ChatTimelineItem[] = []
  let lastDayKey: string | null = null

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const dayKey = localDayKey(new Date(entry.createdAt))
    if (dayKey !== lastDayKey) {
      out.push({ kind: 'day-separator', key: `day:${dayKey}`, label: dayLabel(dayKey, now) })
      lastDayKey = dayKey
    }

    if (entry.kind === 'event') {
      // Gather the contiguous stretch of events (no message between them,
      // same calendar day) into one block.
      const block: ChatThreadEvent[] = [entry.event]
      const blockStartCreatedAt = entry.createdAt
      while (i + 1 < entries.length) {
        const next = entries[i + 1]!
        if (next.kind !== 'event') break
        if (localDayKey(new Date(next.createdAt)) !== dayKey) break
        block.push(next.event)
        i++
      }
      out.push({
        kind: 'event-block',
        key: `evtblock:${block[0]!.id}`,
        entries: groupBlockEvents(block),
        isTrailing: blockStartCreatedAt > lastMessageTs,
      })
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
      if (localDayKey(new Date(next.createdAt)) !== dayKey) break
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
 * Partition one contiguous, same-day event stretch (an event block) into its
 * render entries. Collapse only at ≥3 (§15.4.2) — below that, singles read
 * identically to expanded group members, so grouping saves nothing.
 */
function groupBlockEvents(events: ChatThreadEvent[]): EventBlockEntry[] {
  if (events.length >= 3) return [{ kind: 'group', events }]
  return events.map((event) => ({ kind: 'single', event }))
}

/**
 * Actor-identity key for an event: the branded `actorId` when present (falling
 * back to the legacy `data.userId` payload on pre-cut-over rows), else the
 * automation provenance (`source.kind` + `source.id`), else a shared 'system'
 * bucket. Used by {@link composeEventGroupSummary} to fold/cancel per actor —
 * no longer used to decide which rows visually group (that's day + contiguity
 * now, mixed actors welcome).
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

// ============================================================================
// Day separators (§15.6)
// ============================================================================

/** Viewer-local calendar-day identity — stable across DST, independent of locale. */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * "Today" / "Yesterday" / weekday name (within the last 7 days) / "Aug 12"
 * (+ ", 2025" when the year isn't the current one). Hardcoded weekday/month
 * names, not `toLocaleDateString`, so the label is deterministic in tests
 * regardless of the runner's locale.
 */
function dayLabel(dayKey: string, now: Date): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1 && diffDays < 7) return WEEKDAY_NAMES[date.getDay()]!

  const monthDay = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`
  return date.getFullYear() === now.getFullYear() ? monthDay : `${monthDay}, ${date.getFullYear()}`
}

// ============================================================================
// Group summary composer (§15.5) — pure, unit-testable net-effect composer for
// a collapsed group-row. Folds repeats per actor per type, cancels opposites,
// ranks survivors, and always surfaces the total count.
// ============================================================================

export interface EventGroupSummary {
  /** Up to 2 actor-attributed net-effect fragments, ranked highest first. */
  fragments: string[]
  /** Total raw event count folded into this group — always shown (§15.5 rule 3). */
  count: number
}

/** merged > taken_over/returned_to_ai > archived/reopened > assignee > tagged/untagged. */
const TYPE_TIER: Partial<Record<ThreadEventType, number>> = {
  'thread:merged': 0,
  'thread:taken_over': 1,
  'thread:returned_to_ai': 1,
  'thread:archived': 2,
  'thread:reopened': 2,
  'thread:assignee:changed': 3,
  'thread:tagged': 4,
  'thread:untagged': 4,
}

/**
 * Resolve a display label for an actor-identity key (as produced by
 * {@link eventActorKey}, or the `actor:<ActorId>` form for a referenced
 * assignee target). `sample` is only consulted for automation provenance
 * (`source:*` keys) — the label there is the emit-time snapshot, never a live
 * refined name; that refinement is a per-row concern (`useEventActor`), not
 * the group summary's.
 */
export type GroupActorLabelResolver = (actorKey: string, sample: ChatThreadEvent) => string

function joinList(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]!
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(items)
}

/**
 * Compose the net-effect summary for one collapsed group (§15.5). Folds
 * repeats per actor per type (tag union; assignee → final), cancels opposites
 * (archived↔reopened; tagged x then untagged x) per actor, ranks surviving
 * actor-bundles, and returns the top 2 fragments plus the always-shown count.
 * Non-composable types (`thread:visitor:identified`) contribute to `count`
 * only — they never produce a fragment, and only appear once the group
 * expands.
 */
export function composeEventGroupSummary(
  events: ChatThreadEvent[],
  actorLabel: GroupActorLabelResolver
): EventGroupSummary {
  const order: string[] = []
  const buckets = new Map<string, ChatThreadEvent[]>()
  for (const event of events) {
    const key = eventActorKey(event)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
      order.push(key)
    }
    bucket.push(event)
  }

  interface Bundle {
    tier: number
    text: string
    firstIndex: number
  }
  const bundles: Bundle[] = []

  for (const key of order) {
    const bucketEvents = buckets.get(key)!
    const verbs: { text: string; tier: number }[] = []

    const takeoverEvents = bucketEvents.filter(
      (e) => e.type === 'thread:taken_over' || e.type === 'thread:returned_to_ai'
    )
    if (takeoverEvents.length > 0) {
      const last = takeoverEvents[takeoverEvents.length - 1]!
      verbs.push({
        text:
          last.type === 'thread:taken_over'
            ? 'took over the conversation'
            : 'returned the conversation to AI',
        tier: TYPE_TIER['thread:taken_over']!,
      })
    }

    const archiveEvents = bucketEvents.filter(
      (e) => e.type === 'thread:archived' || e.type === 'thread:reopened'
    )
    if (archiveEvents.length > 0) {
      const last = archiveEvents[archiveEvents.length - 1]!
      verbs.push({
        text: last.type === 'thread:archived' ? 'marked as done' : 'reopened the conversation',
        tier: TYPE_TIER['thread:archived']!,
      })
    }

    const mergedEvents = bucketEvents.filter((e) => e.type === 'thread:merged')
    if (mergedEvents.length > 0) {
      verbs.push({
        text:
          mergedEvents.length > 1
            ? 'merged conversations into this one'
            : 'merged a conversation into this one',
        tier: TYPE_TIER['thread:merged']!,
      })
    }

    const assigneeEvents = bucketEvents.filter((e) => e.type === 'thread:assignee:changed')
    if (assigneeEvents.length > 0) {
      const last = assigneeEvents[assigneeEvents.length - 1]!
      const branded = last.data?.assigneeActorId
      const legacy = last.data?.toUserId
      const targetKey =
        typeof branded === 'string' && branded
          ? `actor:${branded}`
          : typeof legacy === 'string' && legacy
            ? `actor:user:${legacy}`
            : null
      verbs.push({
        text: targetKey
          ? `assigned to ${actorLabel(targetKey, last)}`
          : 'unassigned the conversation',
        tier: TYPE_TIER['thread:assignee:changed']!,
      })
    }

    const tagEvents = bucketEvents.filter(
      (e) => e.type === 'thread:tagged' || e.type === 'thread:untagged'
    )
    if (tagEvents.length > 0) {
      const added = new Map<string, string>()
      const removed = new Map<string, string>()
      for (const e of tagEvents) {
        const ids = Array.isArray(e.data?.tagIds) ? (e.data.tagIds as unknown[]) : []
        const names = Array.isArray(e.data?.tagNames) ? (e.data.tagNames as unknown[]) : []
        ids.forEach((rawId, i) => {
          if (typeof rawId !== 'string' || !rawId) return
          const name = typeof names[i] === 'string' ? (names[i] as string) : rawId
          if (e.type === 'thread:tagged') {
            if (removed.has(rawId)) removed.delete(rawId)
            else added.set(rawId, name)
          } else {
            if (added.has(rawId)) added.delete(rawId)
            else removed.set(rawId, name)
          }
        })
      }
      if (added.size > 0) {
        verbs.push({
          text: `tagged with ${joinList([...added.values()])}`,
          tier: TYPE_TIER['thread:tagged']!,
        })
      }
      if (removed.size > 0) {
        verbs.push({
          text: `removed ${joinList([...removed.values()])}`,
          tier: TYPE_TIER['thread:untagged']!,
        })
      }
    }

    if (verbs.length === 0) continue // fully cancelled, or only non-composable events

    const tier = Math.min(...verbs.map((v) => v.tier))
    const label = actorLabel(key, bucketEvents[0]!)
    bundles.push({
      tier,
      text: `${label} ${joinList(verbs.map((v) => v.text))}`,
      firstIndex: events.indexOf(bucketEvents[0]!),
    })
  }

  bundles.sort((a, b) => a.tier - b.tier || a.firstIndex - b.firstIndex)
  return {
    fragments: bundles.slice(0, 2).map((b) => b.text),
    count: events.length,
  }
}

/**
 * Render a composed summary into the group-row's single line of copy: the
 * fragments joined with `Intl.ListFormat` (never a hand-rolled `', '`/`' and '`
 * — §15.5 rule 4), then the always-on count. "6 updates" alone when nothing
 * survived cancellation.
 */
export function formatEventGroupSummary(summary: EventGroupSummary): string {
  const countText = `${summary.count} update${summary.count === 1 ? '' : 's'}`
  if (summary.fragments.length === 0) return countText
  return `${joinList(summary.fragments)} · ${countText}`
}
