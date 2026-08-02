// packages/lib/src/mail-filters/client.ts
// Client-safe entry point for mail filters — types, the condition-editor field
// catalog and pure summary helpers. No database/server imports.
//
// NOTE: no 'use client' directive. Server code imports this file too (the router's
// zod schema and the engine both read the action vocabulary), and the directive
// would turn every export into a client-reference proxy there.

import { getOperatorDefinition, type Operator } from '../conditions/operator-definitions'
import type { Condition, ConditionGroup } from '../conditions/types'
import {
  MAIL_VIEW_FIELD_DEFINITIONS,
  type MailViewFieldDefinition,
} from '../mail-views/mail-view-field-definitions'
import type { MailFilterAction, MailFilterRow } from './types'

export {
  ACTION_REQUIRING_AUTOMATION_KEY,
  type CachedMailFilter,
  MAIL_FILTER_ACTION_TYPES,
  MAIL_FILTER_STATUSES,
  MAX_PERSONAL_MAIL_FILTERS,
  type MailFilterAction,
  type MailFilterActionOutcome,
  type MailFilterInput,
  type MailFilterRow,
  type MailFilterRunRow,
  type MailFilterRunSource,
  type MailFilterRunStatus,
  type MailFilterUndoState,
} from './types'

/**
 * Mail-view fields a filter must NOT offer.
 *
 * - `inbox` — a filter belongs to exactly one inbox (D6) and `MailFilter.inboxId`
 *   IS the containment boundary (§4.4). A condition on `inbox` would either
 *   restate that boundary or contradict it, and a contradiction silently makes
 *   the filter dead rather than wrong-looking.
 * - `sharedWithMe` — viewer-relative. The engine evaluates as SYSTEM
 *   (`SYSTEM_VISIBILITY`, §4.2), which has no "me", so the predicate has no
 *   meaning on the fire path even though it renders fine in the searchbar.
 * - `freeText` — silently dead on the message that triggers the filter. Its body
 *   arm is `threadBodySearchPredicate`, which reads `Thread.searchText`, and that
 *   column is written only by `updateThreadMetadataEfficient` —
 *   `ingest/store-message.ts` calls it for ALREADY-EXISTING threads only, so on a
 *   brand-new thread it is still NULL when `message:received` publishes. A
 *   `freeText contains "invoice"` filter would therefore never fire on a new
 *   conversation whose word appears only in the body, with no error anywhere.
 *   Nothing is lost: `body` is a correlated `EXISTS` over the `Message` rows the
 *   ingest transaction already committed, and the searchbar entry point converts
 *   `freeText` → `body contains` with a visible notice
 *   (`components/mail-filters/utils/prefill-conditions.ts`).
 */
export const MAIL_FILTER_EXCLUDED_FIELD_IDS: readonly string[] = [
  'inbox',
  'sharedWithMe',
  'freeText',
]

/**
 * The condition-editor field catalog for a mail filter.
 *
 * DERIVED from {@link MAIL_VIEW_FIELD_DEFINITIONS} rather than duplicated: the
 * searchbar, mail views and filters must share one condition language, because
 * they share one evaluator (`mail-query/condition-query-builder.ts`, invariant
 * 5). Adding a field there — `category` in the AI phase, say — makes it
 * filterable here for free; re-declaring the catalog would fork it.
 */
export function getMailFilterFields(): MailViewFieldDefinition[] {
  return MAIL_VIEW_FIELD_DEFINITIONS.filter((f) => !MAIL_FILTER_EXCLUDED_FIELD_IDS.includes(f.id))
}

/** Look up one filterable field by id; undefined when it is excluded or unknown. */
export function getMailFilterField(fieldId: string): MailViewFieldDefinition | undefined {
  return getMailFilterFields().find((f) => f.id === fieldId)
}

/** Human labels for the action catalog and the list cards. */
export const MAIL_FILTER_ACTION_LABELS: Record<MailFilterAction['type'], string> = {
  'set-status': 'Set status',
  'add-tag': 'Add tag',
  'remove-tag': 'Remove tag',
  assign: 'Assign',
  'set-read': 'Mark read',
  'move-inbox': 'Move to inbox',
  'suppress-automations': 'Skip AI & automations',
  'run-agent': 'Run agent',
  'run-workflow': 'Run workflow',
}

/** Human labels for the `set-status` values, matching the mail views' vocabulary. */
const STATUS_LABELS: Record<Extract<MailFilterAction, { type: 'set-status' }>['status'], string> = {
  OPEN: 'Open',
  ARCHIVED: 'Done',
  TRASH: 'Trash',
  SPAM: 'Spam',
}

/** Optional id → display-name resolver, so summaries can name tags/members/inboxes. */
export type MailFilterNameResolver = (id: string) => string | undefined

function nameOf(id: string, resolve?: MailFilterNameResolver): string {
  return resolve?.(id) ?? id
}

function joinNames(ids: string[], resolve?: MailFilterNameResolver): string {
  return ids.map((id) => nameOf(id, resolve)).join(', ')
}

/** One-line summary of a single action, for the actions list and the run history. */
export function describeMailFilterAction(
  action: MailFilterAction,
  resolve?: MailFilterNameResolver
): string {
  switch (action.type) {
    case 'set-status':
      return `Mark as ${STATUS_LABELS[action.status]}`
    case 'add-tag':
      return `Add tag ${joinNames(action.tagIds, resolve)}`
    case 'remove-tag':
      return `Remove tag ${joinNames(action.tagIds, resolve)}`
    case 'assign':
      return `Assign to ${nameOf(action.assigneeId, resolve)}`
    case 'set-read':
      return action.read ? 'Mark as read' : 'Mark as unread'
    case 'move-inbox':
      return `Move to ${nameOf(action.inboxId, resolve)}`
    case 'suppress-automations':
      return 'Skip AI & automations'
    case 'run-agent':
      return `Run agent ${nameOf(action.agentId, resolve)}`
    case 'run-workflow':
      return `Run workflow ${nameOf(action.workflowAppId, resolve)}`
  }
}

function formatValue(value: Condition['value']): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  return String(value)
}

function describeCondition(condition: Condition, resolve?: MailFilterNameResolver): string {
  const fieldId = Array.isArray(condition.fieldId)
    ? String(condition.fieldId[condition.fieldId.length - 1])
    : String(condition.fieldId)
  const label = getMailFilterField(fieldId)?.label ?? fieldId
  const operator = getOperatorDefinition(condition.operator as Operator)
  const operatorLabel = operator?.label ?? String(condition.operator)
  if (operator && !operator.requiresValue) return `${label} ${operatorLabel}`
  const value = formatValue(condition.value)
  const resolved = value && resolve ? (resolve(value) ?? value) : value
  return `${label} ${operatorLabel} ${resolved}`.trim()
}

/** Flatten a filter's condition groups into their individual conditions, in order. */
function flattenConditions(groups: ConditionGroup[]): Condition[] {
  return groups.flatMap((group) => group.conditions ?? [])
}

/**
 * Human-readable "when X, do Y" summary for the filter list cards (§6.1's
 * `RuleListSection` takes a `describe(row)` callback).
 *
 * Truncates at three conditions and three actions: a card is a glance, and the
 * dialog is where the whole filter is read. Pass `resolve` where the caller
 * already holds the tag/member/inbox maps so ids render as names.
 */
export function describeMailFilter(
  filter: Pick<MailFilterRow, 'conditions' | 'actions'>,
  resolve?: MailFilterNameResolver
): string {
  const conditions = flattenConditions(filter.conditions ?? [])
  const shownConditions = conditions.slice(0, 3).map((c) => describeCondition(c, resolve))
  const extraConditions = conditions.length - shownConditions.length
  const when =
    shownConditions.length === 0
      ? 'Every new message'
      : `When ${shownConditions.join(' and ')}${extraConditions > 0 ? ` +${extraConditions} more` : ''}`

  const actions = filter.actions ?? []
  const shownActions = actions.slice(0, 3).map((a) => describeMailFilterAction(a, resolve))
  const extraActions = actions.length - shownActions.length
  if (shownActions.length === 0) return when
  return `${when} → ${shownActions.join(', ')}${extraActions > 0 ? ` +${extraActions} more` : ''}`
}
