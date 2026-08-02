// apps/web/src/components/mail-filters/utils/prefill-conditions.ts

import type { Condition, ConditionGroup, Operator } from '@auxx/lib/conditions/client'
import { operatorRequiresValue } from '@auxx/lib/conditions/client'
import { MAIL_FILTER_EXCLUDED_FIELD_IDS } from '@auxx/lib/mail-filters/client'
import { getInstanceId, isRecordId, type RecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import type { SearchCondition } from '~/components/searchbar/types'

/**
 * Building the `ConditionGroup[]` the mail-filter dialog opens with, from the
 * two creation entry points (§6.3): the thread overflow menu and the mail
 * searchbar.
 *
 * **The shape must not fork.** The dialog's editor, the mail views and the
 * searchbar all speak `ConditionGroup[]` over `MAIL_VIEW_FIELD_DEFINITIONS`,
 * because they all compile through one evaluator
 * (`mail-query/condition-query-builder.ts`, invariant 5). Everything here is a
 * translation INTO that shape — never a second condition language.
 */

/** A flat, group-less condition seed — what both entry points produce. */
export interface PrefillCondition {
  fieldId: string
  operator: Operator
  value: unknown
}

/**
 * Wrap flat conditions into the single AND group the editor renders.
 *
 * One group, not one group per condition: the dialog shows groups as visually
 * separated blocks, and a prefill is one idea ("mail like this"), so it reads as
 * one block that the user then edits.
 */
export function toConditionGroups(conditions: PrefillCondition[]): ConditionGroup[] {
  if (conditions.length === 0) return []
  return [
    {
      id: generateId(),
      logicalOperator: 'AND',
      conditions: conditions.map(
        (condition): Condition => ({
          id: generateId(),
          fieldId: condition.fieldId,
          operator: condition.operator,
          value: condition.value,
        })
      ),
    },
  ]
}

/**
 * Gmail's "Filter messages like this": sender exact, subject fuzzy.
 *
 * `from is <email>` and `subject contains <subject>` — both editable in the
 * dialog, which is the point of prefilling rather than creating. `contains` on
 * the subject is deliberate: an exact subject match would only ever fire on a
 * literal resend, while reply prefixes and ticket suffixes drift constantly.
 */
export function buildThreadPrefillConditions(input: {
  senderEmail?: string | null
  subject?: string | null
}): PrefillCondition[] {
  const conditions: PrefillCondition[] = []
  const sender = input.senderEmail?.trim()
  if (sender) conditions.push({ fieldId: 'from', operator: 'is' as Operator, value: sender })
  const subject = input.subject?.trim()
  if (subject)
    conditions.push({ fieldId: 'subject', operator: 'contains' as Operator, value: subject })
  return conditions
}

/** What a searchbar → filter conversion produced, and what it had to change. */
export interface SearchConversion {
  groups: ConditionGroup[]
  /**
   * Every condition the conversion rewrote or dropped, in plain language.
   *
   * Rendered as a visible banner in the dialog — never a tooltip. A silently
   * dropped or silently widened condition produces a filter that matches
   * strictly MORE mail than the search the user was looking at when they clicked
   * (§6.3), and mail filters mutate conversations.
   */
  notes: string[]
  /**
   * Inbox instance id derived from an `inbox` search condition, when it named
   * exactly one. A filter belongs to exactly one inbox (D6), so an `inbox`
   * search condition is a preselection rather than a condition.
   */
  inboxId?: string
}

/** True when the condition carries a usable value for its operator. */
function hasUsableValue(condition: SearchCondition): boolean {
  if (!operatorRequiresValue(condition.operator)) return true
  const value = condition.value
  if (value === undefined || value === null || value === '') return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

function toInstanceIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .map((v) => (isRecordId(v) ? getInstanceId(v as RecordId) : v))
}

function quote(value: unknown): string {
  const text = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  return text.length > 60 ? `“${text.slice(0, 60)}…”` : `“${text}”`
}

/**
 * Convert the searchbar's live `SearchCondition[]` into the dialog's
 * `ConditionGroup[]`, reporting every difference.
 *
 * Three fields cannot survive the trip, and each is REPORTED rather than
 * silently handled:
 *
 * - **`freeText` → `body contains`.** Filters have no free-text field. The two
 *   are genuinely different predicates, in both directions: free text splits the
 *   query into words, requires all of them, and looks at the subject as well as
 *   the body, while `body contains` matches the whole phrase in message bodies
 *   only. So the converted filter can fire on mail the search never showed —
 *   which is why the note is a banner and not a footnote.
 * - **`inbox` → the filter's inbox.** `MailFilter.inboxId` IS the containment
 *   boundary (§4.4); a condition restating it would be redundant and a
 *   condition contradicting it would make the filter permanently dead.
 * - **`sharedWithMe` → dropped.** Viewer-relative. The engine fires as SYSTEM
 *   (`SYSTEM_VISIBILITY`), which has no "me".
 */
export function convertSearchConditions(conditions: readonly SearchCondition[]): SearchConversion {
  const prefill: PrefillCondition[] = []
  const notes: string[] = []
  let inboxId: string | undefined

  for (const condition of conditions) {
    if (!hasUsableValue(condition)) continue

    if (condition.fieldId === 'freeText') {
      prefill.push({ fieldId: 'body', operator: 'contains' as Operator, value: condition.value })
      notes.push(
        `Your search text ${quote(condition.value)} became the condition “Body contains ${quote(condition.value)}”. Filters have no free-text field, and the two are not the same test: the search matched each word separately across the subject and the body, while this condition looks for the whole phrase in message bodies only. Check it before saving, because as written it can catch mail your search did not show.`
      )
      continue
    }

    if (condition.fieldId === 'inbox') {
      const ids = toInstanceIds(condition.value)
      const only = ids.length === 1 ? ids[0] : undefined
      if (only) {
        inboxId = only
        notes.push(
          'Your inbox filter became the filter’s inbox instead of a condition. A filter always belongs to exactly one inbox and can only ever act on that inbox’s conversations.'
        )
      } else {
        notes.push(
          `Your search covered ${ids.length} inboxes. A filter belongs to exactly one inbox, so pick the inbox below. You will need one filter per inbox.`
        )
      }
      continue
    }

    if (MAIL_FILTER_EXCLUDED_FIELD_IDS.includes(condition.fieldId)) {
      notes.push(
        'The “Shared with me” condition was dropped. It depends on who is looking, and filters run as the system with no viewer.'
      )
      continue
    }

    prefill.push({
      fieldId: condition.fieldId,
      operator: condition.operator,
      value: condition.value,
    })
  }

  return { groups: toConditionGroups(prefill), notes, inboxId }
}

/** True when a search is worth offering "Create filter from this search" for. */
export function hasConvertibleSearchConditions(conditions: readonly SearchCondition[]): boolean {
  return conditions.some((condition) => condition.fieldId !== 'inbox' && hasUsableValue(condition))
}
