// packages/lib/src/record-rules/types.ts
// Shared types for the record-rules engine — org-configurable "when field X changes /
// record created/deleted, and conditions hold, run actions" rules.
// See plans/events/dynamic-field-rules-and-sync-events-plan.md.

import type { ConditionGroup } from '../conditions/types'

/** Transition selector. Direction semantics live on the rule, NOT in conditions. */
export type RecordRuleOn =
  | 'changed'
  | 'increased'
  | 'decreased'
  | 'set'
  | 'cleared'
  | 'created'
  | 'deleted'

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
  value: unknown
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
  message: string
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

export type RecordRuleAction = SetFieldAction | EnqueueWorkflowAction | NotifyAction | NativeAction

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
  /** null ⇔ lifecycle rule (`on: created|deleted`). */
  fieldId: string | null
  name: string
  on: RecordRuleOn
  condition: ConditionGroup[]
  actions: RecordRuleAction[]
  enabled: boolean
  /**
   * True for code-declared system rules unioned into the cache at compute time
   * (`system-rules.ts`) — NOT a DB row. Excluded from the tRPC `list` output and UI.
   */
  isSystem?: boolean
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
}
