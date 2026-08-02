// packages/lib/src/signals/types.ts
// Client-safe kind registry for the EntitySignal substrate (plans/signals/01-signal-store.md
// "Kind registry"). Pure types + constants only — no server-only imports (no drizzle,
// @auxx/database, bullmq) — this file is imported from client UI (filters, icons) as well as
// server writers/handlers.

/** Namespaced verb identifying what happened. Apps/connectors add kinds later (e.g. Shopify
 * `order:placed`) without a migration — this union grows with them. */
export type SignalKind =
  | 'message:sent'
  | 'message:replied'
  | 'email:opened'
  | 'email:clicked'
  | 'email:delivered'
  | 'email:bounced'
  | 'email:complained'
  | 'contact:unsubscribed'
  | 'contact:resubscribed'
  | 'mail:unsubscribed_from'
  | 'web:page_view'
  | 'web:session'
  | 'thread:resolved'
  | 'manual:note'

/** `EntitySignal.subtype` values shipped for `'message:sent'` (dispatch plan 19 §4.1). */
export const MESSAGE_SENT_SUBTYPES = ['sequence_step', 'document_send', 'receipt'] as const
export type MessageSentSubtype = (typeof MESSAGE_SENT_SUBTYPES)[number]

export interface SignalKindMeta {
  label: string
  /** lucide icon name. */
  icon: string
  /** How the timeline projection handles this kind (see "Timeline projection"):
   * `'always'` — every signal becomes a `TimelineEvent` row.
   * `'grouped'` — coalesced into one digest row (e.g. "opened ×3" per message-per-day).
   * `'none'` — never projected; the kind already has its own surface, or isn't display-worthy. */
  timeline: 'always' | 'grouped' | 'none'
  /** Which `EntitySignalRollup` column family this kind contributes to. */
  rollup: 'open' | 'click' | 'visit' | 'reply' | 'unsubscribe' | 'bounce' | 'resubscribe' | 'none'
  /** High-volume kinds are pruned after 180 days by the retention job (rollups persist). */
  highVolume: boolean
}

/** Per-kind metadata: label, icon, timeline grouping behavior, rollup contribution, retention
 * tier. Must cover every `SignalKind`, including the shipped `message:sent` subtypes. */
export const SIGNAL_KINDS: Record<SignalKind, SignalKindMeta> = {
  'message:sent': {
    label: 'Message sent',
    icon: 'send',
    // Message sends already have their own timeline/communications surface.
    timeline: 'none',
    rollup: 'none',
    highVolume: false,
  },
  'message:replied': {
    label: 'Contact replied',
    icon: 'reply',
    // Inbound messages already project onto the timeline as EMAIL_RECEIVED rows
    // (create-timeline-event.ts) — a second "replied" row would duplicate them. The signal
    // exists for rollups (lastRepliedAt), task auto-complete, and the rules door.
    timeline: 'none',
    rollup: 'reply',
    highVolume: false,
  },
  'email:opened': {
    label: 'Email opened',
    icon: 'mail-open',
    timeline: 'grouped',
    rollup: 'open',
    highVolume: true,
  },
  'email:clicked': {
    label: 'Email clicked',
    icon: 'mouse-pointer-click',
    timeline: 'always',
    rollup: 'click',
    highVolume: false,
  },
  'email:delivered': {
    label: 'Email delivered',
    icon: 'mail-check',
    timeline: 'none',
    rollup: 'none',
    highVolume: true,
  },
  'email:bounced': {
    label: 'Email bounced',
    icon: 'mail-x',
    timeline: 'always',
    rollup: 'bounce',
    highVolume: false,
  },
  'email:complained': {
    label: 'Marked as spam',
    icon: 'flag',
    timeline: 'always',
    rollup: 'unsubscribe',
    highVolume: false,
  },
  'contact:unsubscribed': {
    label: 'Unsubscribed',
    icon: 'user-minus',
    timeline: 'always',
    rollup: 'unsubscribe',
    highVolume: false,
  },
  'contact:resubscribed': {
    label: 'Resubscribed',
    icon: 'user-plus',
    timeline: 'always',
    rollup: 'resubscribe',
    highVolume: false,
  },
  /**
   * WE unsubscribed from a list THEY send us (mail-suggestions plan §3/§6.4).
   *
   * ⚠️ The direction is the whole point, and it is the opposite of
   * `contact:unsubscribed`. That kind means the CONTACT unsubscribed from OUR
   * mail, and `signals/unsubscribe.ts` upserts an org-wide **suppression** row
   * on it — recording our own outbound unsubscribe under that kind would
   * silence our mail to that address, a silent and hard-to-trace deliverability
   * bug (invariant 2). Hence `rollup: 'none'`: this event says nothing about
   * their engagement with us and must never move `unsubscribedAt`.
   *
   * `timeline: 'always'` so "you unsubscribed from Stripe updates" lands on the
   * contact timeline when the sender maps to one. Low volume by construction —
   * at most one per (inbox, list), enforced by `MailUnsubscribe`'s unique index.
   */
  'mail:unsubscribed_from': {
    label: 'Unsubscribed from list',
    icon: 'mail-minus',
    timeline: 'always',
    rollup: 'none',
    highVolume: false,
  },
  'web:page_view': {
    label: 'Page view',
    icon: 'eye',
    timeline: 'grouped',
    rollup: 'visit',
    highVolume: true,
  },
  'web:session': {
    label: 'Website visit',
    icon: 'globe',
    timeline: 'always',
    rollup: 'visit',
    highVolume: false,
  },
  'thread:resolved': {
    label: 'Thread resolved',
    icon: 'check-circle',
    // Thread resolution already appears on the timeline via existing events.
    timeline: 'none',
    rollup: 'none',
    highVolume: false,
  },
  'manual:note': {
    label: 'Manual signal',
    icon: 'sticky-note',
    timeline: 'always',
    rollup: 'none',
    highVolume: false,
  },
}

/** All `SignalKind` values, in registry order. */
export const SIGNAL_KIND_LIST: SignalKind[] = Object.keys(SIGNAL_KINDS) as SignalKind[]

/** Kinds pruned after 180 days by the retention job — see "Retention". */
export const HIGH_VOLUME_SIGNAL_KINDS: SignalKind[] = SIGNAL_KIND_LIST.filter(
  (kind) => SIGNAL_KINDS[kind].highVolume
)

/** Narrows a raw string (e.g. a webhook payload's `kind`) to `SignalKind`. */
export function isSignalKind(value: string): value is SignalKind {
  return Object.hasOwn(SIGNAL_KINDS, value)
}
