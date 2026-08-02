// packages/lib/src/mail-suggestions/types.ts
// Shared types for mined mail suggestions — "we looked at your mail and noticed
// something". CLIENT-SAFE: type-only imports and pure constants, no
// database/server dependencies (the UI reaches these through `./client`).
// See plans/mail-filter/03-suggestions-plan.md §4 / §5.

import type { ConditionGroup } from '../conditions/types'
import type { MailFilterAction } from '../mail-filters/types'

/**
 * What a mined suggestion proposes.
 *
 * `unsubscribe` is deliberately NOT a {@link MailFilterAction} (S2 / invariant
 * 1): an action in that union would fire an outbound POST to a third party on
 * every future match. It is a one-shot command against a *list*, and the
 * suggestion pairs it with an ordinary archive filter (S10) so the user gets an
 * effect immediately rather than waiting days for the sender to honour it.
 *
 * `route-inbox` is reserved by the schema but not produced by the miner yet —
 * there is no "this should have gone to the other mailbox" signal in the
 * grouped query.
 */
export type MailSuggestionKind =
  | 'unsubscribe'
  | 'auto-archive'
  | 'auto-tag'
  | 'auto-assign'
  | 'route-inbox'

/** Lifecycle of one card. `dismissed` rows ARE the suppression list (invariant 7). */
export type MailSuggestionStatus = 'new' | 'accepted' | 'dismissed'

/**
 * Which unsubscribe tier the headers support — chosen BY HEADER, never by
 * provider (§6.1). `null` means the sender offered no machine-readable way out,
 * so an unsubscribe suggestion is not offerable at all and the miner proposes
 * an archive filter instead.
 */
export type MailUnsubscribeMethod = 'one-click' | 'http' | 'mailto'

/**
 * Parsed `list-unsubscribe` + `list-unsubscribe-post`, as written onto
 * `Message.unsubscribeMeta` at ingest.
 */
export interface MailUnsubscribeMeta {
  httpUrl?: string
  mailto?: string
  oneClick?: boolean
}

/**
 * Everything the card renders, so display never re-queries (§4).
 *
 * The first eight fields are the plan's shape verbatim. The rest are what the
 * card's title, the safety gate's explanation and the accept flow need: a
 * `list:`/`domain:` key alone does not tell the UI whether the group is a real
 * mailing list (unsubscribable) or a domain guess.
 */
export interface MailSuggestionEvidence {
  /** The mining window, in days — "34 emails in 90 days" reads off this. */
  windowDays: number
  messageCount: number
  threadCount: number
  /** 0–1. Share of the group's threads NOBODY (or, for a personal inbox, the owner) read. */
  unreadRate: number
  /** 0–1. Share of the group's threads archived BY HAND — see `mine.ts` for the exclusion. */
  manualArchiveRate: number
  /** True ⇒ no suggestion may exist for this subjectKey at all (invariant 5). */
  everReplied: boolean
  /** A few threads the user can click through to, newest first. */
  sampleThreadIds: string[]
  /** `null` when the sender published no usable unsubscribe header. */
  unsubscribeMethod: MailUnsubscribeMethod | null
  /** Normalized `List-Id`, or null for a `domain:` group. */
  listId: string | null
  /** Registrable sender domain — present for most groups, including `list:` ones. */
  senderDomain: string | null
  /** DMARC/DKIM verdict. NULL/unknown collapses to `false` here (invariant 3). */
  senderAuthenticated: boolean
  /** Days between the group's oldest and newest message inside the window. */
  historyDays: number
  /** Threads in the group that an existing MailFilter already fired on (invariant 6). */
  filteredThreadCount: number
  /** 0–1 consistency of the dominant tag/assignee — only set for auto-tag/auto-assign. */
  consistency?: number
  /** The dominant tag, for `auto-tag`. */
  tagId?: string
  /** The dominant assignee, for `auto-assign`. */
  assigneeId?: string
}

/** A `MailSuggestion` row as returned to routers and the UI (jsonb columns typed). */
export interface MailSuggestionRow {
  id: string
  organizationId: string
  inboxId: string
  userId: string | null
  kind: MailSuggestionKind
  subjectKey: string
  evidence: MailSuggestionEvidence
  proposedConditions: ConditionGroup[]
  proposedActions: MailFilterAction[]
  status: MailSuggestionStatus
  dismissedAt: Date | null
  acceptedAt: Date | null
  acceptedFilterId: string | null
  createdAt: Date
  updatedAt: Date
}

/** The raw column subset {@link toMailSuggestionRow} reads. */
export interface MailSuggestionRecord {
  id: string
  organizationId: string
  inboxId: string
  userId: string | null
  kind: string
  subjectKey: string
  evidence: unknown
  proposedConditions: unknown
  proposedActions: unknown
  status: string
  dismissedAt: Date | null
  acceptedAt: Date | null
  acceptedFilterId: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * What the miner hands to the upsert — one card, minus the identity the DB
 * assigns. Kept separate from {@link MailSuggestionRow} so the pure
 * threshold/suppression layer can be tested without a database.
 */
export interface MailSuggestionDraft {
  inboxId: string
  /** The member this is FOR: the owner for a personal inbox, `null` org-level. */
  userId: string | null
  kind: MailSuggestionKind
  subjectKey: string
  evidence: MailSuggestionEvidence
  proposedConditions: ConditionGroup[]
  proposedActions: MailFilterAction[]
  /**
   * `messageCount × unreadRate` — the ranking the 5-per-inbox cap applies
   * (invariant 12). Carried on the draft rather than recomputed so the cap and
   * the card agree on the ordering.
   */
  score: number
}

/**
 * Narrow a DB row's jsonb columns to their real types.
 *
 * Pure and structurally typed so it can live beside the client-safe types: the
 * jsonb columns are written by the miner, so this is a cast with an array guard
 * rather than a parse.
 */
export function toMailSuggestionRow(row: MailSuggestionRecord): MailSuggestionRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    inboxId: row.inboxId,
    userId: row.userId,
    kind: row.kind as MailSuggestionKind,
    subjectKey: row.subjectKey,
    evidence: (row.evidence ?? {}) as MailSuggestionEvidence,
    proposedConditions: Array.isArray(row.proposedConditions)
      ? (row.proposedConditions as ConditionGroup[])
      : [],
    proposedActions: Array.isArray(row.proposedActions)
      ? (row.proposedActions as MailFilterAction[])
      : [],
    status: row.status as MailSuggestionStatus,
    dismissedAt: row.dismissedAt,
    acceptedAt: row.acceptedAt,
    acceptedFilterId: row.acceptedFilterId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
