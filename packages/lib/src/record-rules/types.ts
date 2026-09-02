// packages/lib/src/record-rules/types.ts
// Shared types for the record-rules engine — org-configurable "when field X changes /
// record created/deleted, and conditions hold, run actions" rules.
// See plans/events/dynamic-field-rules-and-sync-events-plan.md.

import type { ConditionGroup } from '../conditions/types'
import type { TaskPriority } from '../tasks/types'
import type { TiptapDoc } from '../tiptap/types'

/**
 * Transition selector. Direction semantics live on the rule, NOT in conditions.
 * `'signal'` is the signal door (Step 3): `signalKind` NOT NULL, `fieldId` IS NULL — the
 * counterpart of the lifecycle rules' `fieldId IS NULL` invariant (see `assertRuleShape`).
 */
export type RecordRuleOn =
  | 'changed'
  | 'increased'
  | 'decreased'
  | 'set'
  | 'cleared'
  | 'created'
  | 'deleted'
  | 'signal'

export const FIELD_TRANSITIONS: readonly RecordRuleOn[] = [
  'changed',
  'increased',
  'decreased',
  'set',
  'cleared',
]

export const LIFECYCLE_TRANSITIONS: readonly RecordRuleOn[] = ['created', 'deleted']

/** Write a value onto a field of the triggering record. `fieldRef` = field id OR systemAttribute. */
export interface SetFieldAction {
  type: 'set-field'
  fieldRef: string
  /**
   * Tiptap JSON doc with `placeholder` token nodes (plans/signals/07-action-placeholders.md).
   * A doc whose only meaningful content is a single token resolves to the RAW value (type
   * preserved); mixed content flattens to a string. Legacy pre-07 rows carry a raw value
   * (string/number/…), written verbatim — hence `unknown` rather than `TiptapDoc | string`.
   */
  value: unknown
  /**
   * Write mode for MULTI-VALUE target fields (`options.multi`, MULTI_SELECT, TAGS, …).
   * `'set'` (default) replaces the field's whole stored list with the resolved value;
   * `'add'` appends without touching existing values. Ignored (treated as `'set'`) when
   * the target field is single-value. No builder UI exposes this yet — rules default to
   * replace, and the executor guards the append routing on the field actually being multi.
   */
  mode?: 'set' | 'add'
}

/** Enqueue a published workflow with the record snapshot as trigger payload. */
export interface EnqueueWorkflowAction {
  type: 'enqueue-workflow'
  workflowAppId: string
}

/** In-app notification to specific members. */
export interface NotifyAction {
  type: 'notify'
  userIds: string[]
  /**
   * Tiptap JSON doc with `placeholder` token nodes, flattened to text at execution
   * (plans/signals/07-action-placeholders.md).
   */
  message: TiptapDoc
}

/**
 * Invoke a code-registered handler (batch signature) once per rule across a fire
 * batch. SERVER-DECLARED ONLY — never accepted from the tRPC router or the UI; used
 * exclusively by system rules (see `system-rules.ts`, `registerNativeRuleHandler`).
 */
export interface NativeAction {
  type: 'native'
  /** Key registered via `registerNativeRuleHandler`. */
  handler: string
}

/**
 * Create a follow-up task from the fired record (decision 11 — v1 scope). Registered as
 * a normal (non-native) action: immediately usable on field/lifecycle/sync/signal doors
 * alike, no `managed` gate. Dedupe + completion cooldown (decision 7) and placeholder-
 * token title resolution are handled by the executor (`actions.ts`).
 */
export interface CreateTaskAction {
  type: 'create-task'
  /**
   * Tiptap JSON doc with `placeholder` token nodes, flattened to text at execution
   * (plans/signals/07-action-placeholders.md).
   */
  title: TiptapDoc
  /** Fixed assignee user ids. No record-owner strategy yet (decision 11). */
  assigneeIds?: string[]
  /** Relative deadline in days from firing time, resolved the same way `createTask` does. */
  deadlineDays?: number
  priority?: TaskPriority
  /** `'contact_reply'` — a later `message:replied` signal for the referenced contact auto-completes the task. */
  autoCompleteOn?: 'contact_reply'
}

export type RecordRuleAction =
  | SetFieldAction
  | EnqueueWorkflowAction
  | NotifyAction
  | NativeAction
  | CreateTaskAction

/**
 * Does an action list contain a native action? THE shared predicate for routing a rule
 * between the two dispatch doors: door 1 (`hook-handler.ts`) EXCLUDES native rules and
 * the batched field-trigger door (`collect-triggers.ts` + `field-hook-job.ts`) fires
 * ONLY them — the two sides must stay exact complements, so both call this. A rule is
 * all-native or native-free (`assertRuleShape` / `declareSystemRules`), never mixed.
 */
export function hasNativeAction(actions: readonly RecordRuleAction[]): boolean {
  return actions.some((a) => a.type === 'native')
}

/** Per-action result recorded on the RecordRuleRun row (continue-and-report semantics). */
export interface RecordRuleActionOutcome {
  actionIndex: number
  type: RecordRuleAction['type']
  status: 'ok' | 'failed' | 'skipped'
  error?: string
}

/** Serializable cached rule shape (org cache key `recordRules`). */
export interface CachedRecordRule {
  id: string
  organizationId: string
  entityDefinitionId: string
  /** null ⇔ lifecycle rule (`on: created|deleted`) or signal rule (`on: 'signal'`). */
  fieldId: string | null
  name: string
  on: RecordRuleOn
  /** The watched signal kind, e.g. `'email:opened'`. Non-null ⇔ `on === 'signal'`. */
  signalKind?: string | null
  condition: ConditionGroup[]
  actions: RecordRuleAction[]
  enabled: boolean
  /**
   * Managed-feature marker (mirrors the `managed` DB column). Non-null ⇔ the row is
   * provisioned + locked by a feature flow (e.g. `'inventory'` — inventory-source setup);
   * such rows MAY carry native actions and are edit/delete-locked in `settings/rules`.
   * NULL/undefined ⇔ an ordinary user rule.
   */
  managed?: 'inventory' | null
  /**
   * True for code-declared system rules unioned into the cache at compute time
   * (`system-rules.ts`) — NOT a DB row. Excluded from the tRPC `list` output and UI.
   */
  isSystem?: boolean
  /**
   * Do not dispatch this field rule for a field written as part of its
   * record's CREATION. A `changed` rule that recomputes something from the
   * row cannot do its job from inside the creating transaction anyway (the
   * row is uncommitted for the pool connection it reads on), and the def's
   * lifecycle `created` rule owns that case. System-declared only.
   */
  skipOnCreate?: boolean
}

/** One record event within a batch fire (see `fireRecordRulesBatch`). */
export interface RecordRuleBatchEvent {
  entityInstanceId: string
  /** Field-transition context — absent on lifecycle events. */
  fieldId?: string
  oldValue?: unknown
  newValue?: unknown
  /** Record payload for condition evaluation; see `RecordRuleFireContext.snapshot`. */
  snapshot?: Record<string, unknown> | null
  /**
   * Raw create/delete-time field values keyed by systemAttribute (the legacy
   * `EntityTriggerEvent.values` shape). Populated by the dispatching door when it holds
   * them — interactive lifecycle passes `event.data.eventData`, the sync consumer passes
   * `manifest.createdValues`. Forwarded verbatim to native handlers; NEVER refetched (a DB
   * refetch is wrong for the transient stock-movement `adjust_subparts` flag — see
   * plans/events/b2-phase9-option-a-plan.md Part 1).
   */
  eventData?: Record<string, unknown>
}

/**
 * Context handed to the batch engine entry point. Rules are pre-filtered by def by the
 * caller; the batch matches each rule to each event (field id + transition, or
 * lifecycle) and fires non-native actions per record, native actions once per rule.
 */
export interface RecordRuleBatchContext {
  organizationId: string
  entityDefinitionId: string
  source: 'interactive' | 'sync'
  /** Actor of the originating write, when there was one. */
  userId?: string
  events: RecordRuleBatchEvent[]
}

/** Context handed to the engine for one candidate firing. */
export interface RecordRuleFireContext {
  organizationId: string
  entityDefinitionId: string
  entityInstanceId: string
  source: 'interactive' | 'sync'
  /** Actor of the originating write, when there was one. */
  userId?: string
  /** Field-transition context — absent on lifecycle firings. */
  fieldId?: string
  oldValue?: unknown
  newValue?: unknown
  /**
   * Record payload for condition evaluation. When absent the engine fetches it;
   * `deleted` firings MUST provide it (the record is gone) — last-known values.
   */
  snapshot?: Record<string, unknown> | null
  /**
   * Signal-door provenance (`on: 'signal'` firings, see `handle-signal-record-rules.ts`) —
   * read by actions that want to stamp signal provenance (e.g. a future `create-task`
   * action's `sourceSignalId`). Absent for field/lifecycle/sync firings.
   */
  signal?: {
    signalId: string
    kind: string
    contactEntityInstanceId?: string
    /** The signal's `subtype` (e.g. `'sequence_step'`), for `signal:subtype` action tokens. */
    subtype?: string
    /** ISO timestamp the signal occurred at, for `signal:occurredAt` action tokens. */
    occurredAt?: string
  }
}
