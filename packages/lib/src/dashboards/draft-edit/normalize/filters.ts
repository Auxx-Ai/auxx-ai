// packages/lib/src/dashboards/draft-edit/normalize/filters.ts

/**
 * Widget-filter normalization and the SAVE-TIME compile gate. SERVER-ONLY
 * (reads the org cache and the drizzle condition builders).
 *
 * Two jobs, and the second is the one that matters:
 *
 * 1. Resolve every condition's field name to a ref scoped to the widget's own
 *    source ({@link resolveFieldTarget}) and every select value to its option
 *    KEY ({@link resolveOptionValue}).
 * 2. ASSERT THE WHOLE SET COMPILES, and reject the write when it does not.
 *
 * WHY (2) EXISTS. The condition builders are deliberately FAIL-OPEN: a
 * condition they have no case for is DROPPED and the query runs without it, so
 * a saved record view naming a retired field still renders instead of erroring
 * at the user. `ConditionQueryResult` documents that as correct for stored
 * views and dashboard widgets, and it is.
 *
 * It is exactly wrong for a config being AUTHORED. `buildGroupedQuery` returns
 * `sql: undefined` for "no filter requested" and for "every filter requested
 * was dropped" alike, so an all-dropped set reduces to the bare organization
 * scope and matches EVERY row in the org. On a list that shows as extra rows;
 * on an aggregate it shows as nothing at all, because the bar is simply taller
 * and the KPI simply bigger. The agent says "filter applied", the widget shows
 * unfiltered data, and nobody reading the tile can tell. That is the worst
 * possible outcome of the three, so authoring refuses where rendering widens.
 *
 * This is the same gate `mail-filters/evaluate.ts`'s
 * `assertFilterConditionsCompile` is, for the same reason, against a different
 * builder pair. The difference is that this one returns a `Result` rather than
 * throwing, because it sits inside a mutation pipeline that reports refusals as
 * `blockedBy` issues.
 */

import { schema } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { getCachedResourceFields } from '../../../cache'
import {
  type Condition,
  type ConditionGroup,
  getOperatorDefinition,
  type Operator,
  resolveConditionContext,
} from '../../../conditions'
import { type AuxxError, BadRequestError } from '../../../errors'
import { extractRequiredRelatedEntities } from '../../../resources/crud/unified-handler-queries'
import type { DroppedCondition } from '../../../resources/query-builder/base-condition-builder'
import { canonicalizeSystemConditions } from '../../../resources/query-builder/canonicalize-system-fields'
import { entityConditionBuilder } from '../../../resources/query-builder/entity-condition-builder'
import { systemConditionBuilder } from '../../../resources/query-builder/system-condition-builder'
import type { TableId } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import type { WidgetSource } from '../../client'
import {
  loadSourceFields,
  resolveFieldTarget,
  resolveOptionValue,
  sourceResourceId,
} from './field-refs'

/**
 * A stand-in viewer id used ONLY to make the compile probe see what a real run
 * will see. A condition carrying `valueSource: 'currentUser'` is substituted at
 * query time from the request context, and an unsubstituted one is reported as
 * `unresolved-value-source` - a drop the author cannot act on and which does
 * not describe how the widget will actually behave. The compiled SQL is thrown
 * away, so the value never reaches a query.
 */
const COMPILE_PROBE_USER_ID = '__compile_probe__'

/** The label a person would recognise for a condition's operator. */
function operatorLabel(operator: string): string {
  return getOperatorDefinition(operator as Operator)?.label ?? operator
}

/** A dropped condition in the author's vocabulary, named rather than counted. */
function describeDropped(dropped: DroppedCondition, fields: ResourceField[]): string {
  const raw = Array.isArray(dropped.fieldRef) ? dropped.fieldRef.join('.') : dropped.fieldRef
  const tail = String(raw).split(':').pop() ?? String(raw)
  const field = fields.find((f) => f.id === tail || f.key === tail)
  const name = field ? field.label : String(raw)
  const operator = operatorLabel(dropped.operator)
  switch (dropped.reason) {
    case 'unresolved-value-source':
      return `"${name} ${operator}" uses a dynamic value a widget filter cannot resolve`
    default:
      return `"${name}" does not support the "${operator}" operator${
        dropped.detail ? ` (${dropped.detail})` : ''
      }`
  }
}

/**
 * Compile the condition set the way the aggregate engine will and reject when
 * anything would be silently dropped.
 *
 * Mirrors `prepareAggregate`'s two branches exactly, because a check that
 * compiles differently from the run path is not a check:
 *
 * - entity sources go through `entityConditionBuilder` over `EntityInstance`,
 *   with the related-entity field sets a relationship-path condition needs;
 * - system sources go through `canonicalizeSystemConditions` first (a stored
 *   widget may address a system field by the org's merged `CustomField` cuid
 *   while the builder resolves against the static registry key - left
 *   untranslated, every such condition drops) and then
 *   `systemConditionBuilder`.
 *
 * @returns `ok` when every condition compiled, or a {@link BadRequestError}
 * naming each offending field and operator.
 */
export async function assertWidgetFilterConditionsCompile(
  orgId: string,
  source: WidgetSource,
  groups: ConditionGroup[]
): Promise<Result<void, AuxxError>> {
  if (groups.length === 0) return ok(undefined)

  const rootFields = await loadSourceFields(orgId, source)
  const resolved = resolveConditionContext(groups, { currentUserId: COMPILE_PROBE_USER_ID })

  let dropped: DroppedCondition[]
  if (source.kind === 'entity') {
    const relatedEntityFields: Record<string, ResourceField[]> = {}
    for (const relatedDefId of extractRequiredRelatedEntities(resolved, rootFields)) {
      relatedEntityFields[relatedDefId] = await getCachedResourceFields(orgId, relatedDefId)
    }
    dropped = entityConditionBuilder.buildGroupedQueryWithDiagnostics(resolved, {
      fields: rootFields,
      outerTable: schema.EntityInstance,
      relatedEntityFields,
    }).droppedConditions
  } else {
    const tableId = sourceResourceId(source) as TableId
    const canonical = canonicalizeSystemConditions(resolved, tableId, rootFields)
    dropped = systemConditionBuilder.buildGroupedQueryWithDiagnostics(
      canonical,
      tableId
    ).droppedConditions
  }

  if (dropped.length === 0) return ok(undefined)

  const reasons = dropped.map((d) => describeDropped(d, rootFields)).join('; ')
  return err(
    new BadRequestError(
      `This filter cannot be saved because ${reasons}. A condition the query builder cannot ` +
        'compile is dropped silently at render time, so the widget would show unfiltered data ' +
        'while reporting the filter as applied. Pick a different field or operator.',
      { droppedConditions: dropped.map((d) => `${String(d.fieldRef)} ${d.operator}`) }
    )
  )
}

/**
 * Normalize a widget's filter groups against the widget's own source: friendly
 * field names to scoped refs, select labels to option keys, then the compile
 * gate above.
 *
 * Every unresolvable field is reported in ONE error rather than the first one
 * found, so a caller fixing a three-condition filter is not made to round-trip
 * three times. Sub-conditions are walked too; the builders read them.
 */
export async function normalizeFilters(
  orgId: string,
  source: WidgetSource,
  groups: ConditionGroup[],
  sourceLabel?: string
): Promise<Result<ConditionGroup[], AuxxError>> {
  const problems: string[] = []

  const normalizeCondition = async (condition: Condition): Promise<Condition> => {
    const next: Condition = { ...condition }

    if (condition.subConditions?.length) {
      next.subConditions = []
      for (const sub of condition.subConditions) {
        next.subConditions.push(await normalizeCondition(sub))
      }
    }

    const rawField = condition.fieldId
    if (rawField === undefined || rawField === null || rawField === '') {
      problems.push(`a condition with the "${condition.operator}" operator names no field`)
      return next
    }

    const target = await resolveFieldTarget(
      orgId,
      source,
      rawField as string | readonly string[],
      sourceLabel
    )
    if (target.isErr()) {
      problems.push(target.error.message)
      return next
    }

    next.fieldId = target.value.ref as Condition['fieldId']

    if (condition.value !== undefined && condition.value !== null) {
      const value = resolveOptionValue(target.value.field, condition.value)
      if (value.isErr()) {
        problems.push(value.error.message)
        return next
      }
      next.value = value.value
    }

    return next
  }

  const normalized: ConditionGroup[] = []
  for (const group of groups) {
    const conditions: Condition[] = []
    for (const condition of group.conditions) {
      conditions.push(await normalizeCondition(condition))
    }
    normalized.push({ ...group, conditions })
  }

  if (problems.length > 0) {
    return err(new BadRequestError(`This filter cannot be saved. ${problems.join(' ')}`))
  }

  const compiles = await assertWidgetFilterConditionsCompile(orgId, source, normalized)
  if (compiles.isErr()) return err(compiles.error)

  return ok(normalized)
}
