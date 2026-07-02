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

export type RecordRuleAction = SetFieldAction | EnqueueWorkflowAction | NotifyAction

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
