// packages/lib/src/mail-filters/types.ts
// Shared types for mail filters — Gmail-style "when a new message in this inbox
// matches X, do Y" rules. CLIENT-SAFE: type-only imports and pure constants, no
// database/server dependencies (the UI reaches these through `./client`).
// See plans/mail-filter/02-mail-filters-plan.md §2 / §4.3.

import type { ConditionGroup } from '../conditions/types'

/**
 * The ordered action list a filter executes when it matches (plan §4.3).
 *
 * Every variant maps onto an EXISTING execution path — the executor writes no
 * thread state of its own (invariant 1), which is what keeps mail counts,
 * realtime publishes and provider push-back correct.
 *
 * **`RESOLVED` is deliberately absent from `set-status`.** It exists in the DB
 * enum, but `ThreadUpdates.status` (`threads/thread-mutation.service.ts:31`)
 * accepts only `OPEN | ARCHIVED | SPAM | TRASH | IGNORED`, and mail's "done"
 * already maps to `ARCHIVED` everywhere else — `buildStatusQuery` and
 * `MAIL_VIEW_FIELD_DEFINITIONS`' `done` option both resolve to `ARCHIVED`.
 * Offering `RESOLVED` here would either need the service union widened or would
 * produce a status the mail views cannot render.
 *
 * **`run-agent` carries `agentTriggerId` as well as `agentId`** because the
 * `executeAgentEventTrigger` job payload requires it
 * (`events/handlers/trigger-agents.ts:81`) — that queue has no "just run agent
 * X" entry point, so the action must pick agent *and* trigger.
 */
export type MailFilterAction =
  | { type: 'set-status'; status: 'OPEN' | 'ARCHIVED' | 'TRASH' | 'SPAM' }
  | { type: 'add-tag'; tagIds: string[] }
  | { type: 'remove-tag'; tagIds: string[] }
  | { type: 'assign'; assigneeId: string }
  | { type: 'set-read'; read: boolean }
  | { type: 'move-inbox'; inboxId: string }
  | { type: 'suppress-automations' }
  | { type: 'run-agent'; agentId: string; agentTriggerId: string }
  | { type: 'run-workflow'; workflowAppId: string }

/** Every action `type` in {@link MailFilterAction}, for runtime validation. */
export const MAIL_FILTER_ACTION_TYPES: readonly MailFilterAction['type'][] = [
  'set-status',
  'add-tag',
  'remove-tag',
  'assign',
  'set-read',
  'move-inbox',
  'suppress-automations',
  'run-agent',
  'run-workflow',
]

/** The `set-status` values a filter may write (see the note on {@link MailFilterAction}). */
export const MAIL_FILTER_STATUSES: readonly Extract<
  MailFilterAction,
  { type: 'set-status' }
>['status'][] = ['OPEN', 'ARCHIVED', 'TRASH', 'SPAM']

/**
 * The actions that enqueue ORG AUTOMATION and therefore stay keyed on
 * `automationRules.manage` (invariant 15).
 *
 * Every other action only moves mail the author already controls; these two let
 * a filter start work that runs as the org. The router rejects them for an
 * unkeyed author on save — hiding them in the UI catalog is not enough, or
 * personal filters become an unkeyed door into org automation.
 */
export const ACTION_REQUIRING_AUTOMATION_KEY: readonly MailFilterAction['type'][] = [
  'run-agent',
  'run-workflow',
]

/**
 * Flat per-user ceiling on filters over a member's own personal inbox (§5.2).
 *
 * Purely an abuse stop, NOT a plan limit: every member may filter their own
 * mailbox (D14), so personal filters are counted per user and never against the
 * org's `mailFiltersLimit` — pooling them would let one colleague exhaust the
 * org allowance for everyone else.
 */
export const MAX_PERSONAL_MAIL_FILTERS = 50

/** Per-action result on the run row — continue-and-report semantics (§4.5). */
export interface MailFilterActionOutcome {
  actionIndex: number
  type: MailFilterAction['type']
  status: 'ok' | 'failed' | 'skipped'
  error?: string
}

/** Aggregate status of one firing: all-ok, some-failed, or nothing succeeded. */
export type MailFilterRunStatus = 'ok' | 'partial' | 'failed'

/**
 * Which door fired a run. Part of the unique claim key
 * `(filterId, messageId, source)` so a retroactive backfill and a live firing on
 * the same message are DISTINCT rows (§3).
 */
export type MailFilterRunSource = 'live' | 'retroactive'

/**
 * Pre-action thread state captured by the post-execution UPDATE, so a user can
 * reverse one firing from the thread badge or the run history (§6.3).
 *
 * `read` is scalar and therefore only round-trips while `set-read` stays
 * personal-inbox-only — read state is per-user (`ThreadReadStatus` is unique on
 * `(threadId, userId)`), so a shared-inbox `set-read` could not be undone from
 * this shape (§4.3).
 */
export interface MailFilterUndoState {
  status: string | null
  assigneeId: string | null
  inboxId: string | null
  tagIds: string[]
  read: boolean | null
}

/**
 * The dehydrated shape held in the `mailFilters` org-cache key.
 *
 * Deliberately narrower than {@link MailFilterRow}: the gate reads this on every
 * inbound message, so it carries only what evaluation and execution need —
 * no timestamps, no author. `templateKey` stays because the UI badges seeded
 * suggestions and the billable counter excludes them.
 */
export interface CachedMailFilter {
  id: string
  inboxId: string
  name: string
  order: number
  stopProcessing: boolean
  enabled: boolean
  conditions: ConditionGroup[]
  actions: MailFilterAction[]
  templateKey: string | null
}

/** A `MailFilter` row as returned to routers and the UI (jsonb columns typed). */
export interface MailFilterRow {
  id: string
  organizationId: string
  inboxId: string
  name: string
  order: number
  stopProcessing: boolean
  enabled: boolean
  conditions: ConditionGroup[]
  actions: MailFilterAction[]
  createdByUserId: string | null
  templateKey: string | null
  lastFiredAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** A `MailFilterRun` row as returned to routers and the UI (jsonb columns typed). */
export interface MailFilterRunRow {
  id: string
  organizationId: string
  filterId: string
  threadId: string
  messageId: string
  outcomes: MailFilterActionOutcome[]
  status: MailFilterRunStatus
  undo: MailFilterUndoState | null
  undoneAt: Date | null
  source: MailFilterRunSource
  firedAt: Date
}

/** Write payload for `createMailFilter` / `updateMailFilter`. */
export interface MailFilterInput {
  inboxId: string
  name: string
  conditions: ConditionGroup[]
  actions: MailFilterAction[]
  stopProcessing?: boolean
  enabled?: boolean
  /** Idempotency key for seeded suggestions. NULL for user-authored filters. */
  templateKey?: string | null
}

/** The raw column subset both {@link toMailFilterRow} and dehydration read. */
export interface MailFilterRecord {
  id: string
  organizationId: string
  inboxId: string
  name: string
  order: number
  stopProcessing: boolean
  enabled: boolean
  conditions: unknown
  actions: unknown
  createdByUserId: string | null
  templateKey: string | null
  lastFiredAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Narrow a DB row's `unknown[]` jsonb columns to their real types.
 *
 * Pure and structurally typed so it can live beside the client-safe types: the
 * jsonb columns are written by `assertFilterShape`-validated input, so this is a
 * cast with an array guard rather than a parse.
 */
export function toMailFilterRow(row: MailFilterRecord): MailFilterRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    inboxId: row.inboxId,
    name: row.name,
    order: row.order,
    stopProcessing: row.stopProcessing,
    enabled: row.enabled,
    conditions: Array.isArray(row.conditions) ? (row.conditions as ConditionGroup[]) : [],
    actions: Array.isArray(row.actions) ? (row.actions as MailFilterAction[]) : [],
    createdByUserId: row.createdByUserId,
    templateKey: row.templateKey,
    lastFiredAt: row.lastFiredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** The raw `MailFilterRun` column subset {@link toMailFilterRunRow} reads. */
export interface MailFilterRunRecord {
  id: string
  organizationId: string
  filterId: string
  threadId: string
  messageId: string
  outcomes: unknown
  status: string
  undo: unknown
  undoneAt: Date | null
  source: string
  firedAt: Date
}

/** Narrow a `MailFilterRun` DB row's jsonb columns to their real types. */
export function toMailFilterRunRow(row: MailFilterRunRecord): MailFilterRunRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    filterId: row.filterId,
    threadId: row.threadId,
    messageId: row.messageId,
    outcomes: Array.isArray(row.outcomes) ? (row.outcomes as MailFilterActionOutcome[]) : [],
    status: row.status as MailFilterRunStatus,
    undo: (row.undo as MailFilterUndoState | null) ?? null,
    undoneAt: row.undoneAt,
    source: row.source as MailFilterRunSource,
    firedAt: row.firedAt,
  }
}
