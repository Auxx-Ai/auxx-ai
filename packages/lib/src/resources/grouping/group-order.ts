// packages/lib/src/resources/grouping/group-order.ts

import { type SQL, sql } from 'drizzle-orm'
import { getCachedAgents, getCachedGroups, getCachedMembers } from '../../cache'
import type { GroupDateGranularity } from '../../conditions/view-config'
import { UnprocessableEntityError } from '../../errors'
import { bucketExpr } from '../aggregate/date-buckets'
import type { EntityQueryContext } from '../query-builder/entity-condition-builder'
import { entityConditionBuilder } from '../query-builder/entity-condition-builder'
import type { ResourceField } from '../registry/field-types'
import { getFieldOptions } from '../registry/option-helpers'
import { EMPTY_GROUP_KEY, isGroupableField } from './client'
import type { GroupByInput } from './types'

/** Storage kind that decides a group's key and rank expressions. */
type GroupKind = 'select' | 'relationship' | 'actor' | 'checkbox' | 'date' | 'datetime'

/** The SQL a grouped query needs: the raw text key and the ORDER BY that keeps groups contiguous. */
export interface GroupOrder {
  field: ResourceField
  /** Text group key per row; `NULL` is the "No value" group. */
  keyExpr: SQL
  /** `[rank, key]` (or `[key]`), NULLS LAST under both directions. */
  orderBy: SQL[]
  /** The same order over an already-computed key (the summary's grouped subquery). */
  orderByKey: (key: SQL) => SQL[]
}

function groupKind(field: ResourceField): GroupKind | undefined {
  switch (field.fieldType) {
    case 'SINGLE_SELECT':
      return 'select'
    case 'RELATIONSHIP':
      return 'relationship'
    case 'ACTOR':
      return 'actor'
    case 'CHECKBOX':
      return 'checkbox'
    case 'DATE':
      return 'date'
    case 'DATETIME':
      return 'datetime'
    default:
      return undefined
  }
}

/**
 * Resolve the group field the way `buildOrderBySql` resolves a sort id, refusing
 * anything the table would not offer rather than silently ungrouping.
 */
export function resolveGroupField(fieldId: string, context: EntityQueryContext): ResourceField {
  if (fieldId.includes('::')) {
    throw new UnprocessableEntityError('Grouping by a related-record path is not supported')
  }
  const field = entityConditionBuilder.resolveFieldRef(fieldId, context)
  if (!field) throw new UnprocessableEntityError(`Unknown group field '${fieldId}'`)
  // CALC values are computed on read and never stored, so SQL cannot group on them.
  if (!isGroupableField(field) || !groupKind(field)) {
    throw new UnprocessableEntityError(`Field '${field.label ?? fieldId}' cannot be grouped by`)
  }
  return field
}

/** Refuse a zone Postgres would reject mid-query (which would surface as a 500). */
export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new UnprocessableEntityError(`Unknown timezone '${timezone}'`)
  }
}

/** A text[] literal from bind params; drizzle would otherwise expand a JS array to `($1, $2)`. */
export function textArray(values: readonly string[]): SQL {
  if (values.length === 0) return sql`ARRAY[]::text[]`
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `
  )}]::text[]`
}

/** Every option key in option order, `id` and `value` both — stored keys may be either. */
export function optionOrderKeys(field: ResourceField): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const option of getFieldOptions(field)) {
    for (const key of [option?.id, option?.value]) {
      if (key && !seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }
  return keys
}

/**
 * Actor ids (users, agents and agent users, groups) sorted by display name — the
 * bounded key set an ACTOR group ranks against. Mirrors `resolveGroupLabels`' naming.
 */
export async function loadActorGroupOrder(organizationId: string): Promise<string[]> {
  const [members, agents, groups] = await Promise.all([
    getCachedMembers(organizationId),
    getCachedAgents(organizationId),
    getCachedGroups(organizationId),
  ])
  const nameById = new Map<string, string>()
  for (const group of groups) if (group.displayName) nameById.set(group.id, group.displayName)
  for (const agent of agents) {
    if (!agent.name) continue
    nameById.set(agent.id, agent.name)
    if (agent.userId) nameById.set(agent.userId, agent.name)
  }
  for (const member of members) {
    const name = member.user?.name || member.user?.email
    if (member.user?.id && name) nameById.set(member.user.id, name)
  }
  return [...nameById.entries()]
    .sort(
      ([aId, a], [bId, b]) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }) || aId.localeCompare(bId)
    )
    .map(([id]) => id)
}

/** The row's single stored value for a custom field — same subquery shape as `buildOrderBySql`. */
function fieldValueSubquery(column: SQL, fieldId: string, context: EntityQueryContext): SQL {
  return sql`(
      SELECT ${column}
      FROM "FieldValue"
      WHERE "FieldValue"."entityId" = ${context.outerTable.id}
        AND "FieldValue"."fieldId" = ${fieldId}
      ORDER BY "FieldValue"."sortKey" ASC
      LIMIT 1
    )`
}

/** The real `EntityInstance` column behind a system field, when it has one (else FieldValue). */
export function directColumn(field: ResourceField, context: EntityQueryContext) {
  if (!field.isSystem || !field.dbColumn) return undefined
  const column = context.outerTable[field.dbColumn as keyof typeof context.outerTable]
  return column && typeof column === 'object' && 'name' in column ? column : undefined
}

function rawValueExpr(field: ResourceField, kind: GroupKind, context: EntityQueryContext): SQL {
  const column = directColumn(field, context)
  if (column) {
    // A naive `timestamp` column holds UTC; make it a timestamptz before bucketing.
    const withTimezone = (column as { withTimezone?: boolean }).withTimezone
    if ((kind === 'date' || kind === 'datetime') && withTimezone === false) {
      return sql`(${column} AT TIME ZONE 'UTC')`
    }
    return sql`${column}`
  }
  const fieldId = field.id || field.key
  switch (kind) {
    case 'select':
      return fieldValueSubquery(sql`"FieldValue"."optionId"`, fieldId, context)
    case 'relationship':
      return fieldValueSubquery(sql`"FieldValue"."relatedEntityId"`, fieldId, context)
    case 'actor':
      return fieldValueSubquery(
        sql`COALESCE("FieldValue"."actorId", "FieldValue"."relatedEntityId")`,
        fieldId,
        context
      )
    case 'checkbox':
      return fieldValueSubquery(sql`"FieldValue"."valueBoolean"`, fieldId, context)
    case 'date':
    case 'datetime':
      return fieldValueSubquery(sql`"FieldValue"."valueDate"`, fieldId, context)
  }
}

/**
 * Build the group key + ORDER BY for a resolved group field. Pure: `actorOrder`
 * must be supplied for ACTOR fields (see {@link loadActorGroupOrder}).
 *
 * DATE fields are calendar days stored at UTC midnight, so they bucket in UTC;
 * only DATETIME buckets in the viewer's `timezone`.
 */
export function buildGroupOrderBy(params: {
  field: ResourceField
  groupBy: GroupByInput
  context: EntityQueryContext
  timezone: string
  actorOrder?: readonly string[]
}): GroupOrder {
  const { field, groupBy, context } = params
  const kind = groupKind(field)
  if (!kind) throw new UnprocessableEntityError(`Field '${field.label}' cannot be grouped by`)

  const raw = rawValueExpr(field, kind, context)
  const granularity: GroupDateGranularity = groupBy.dateGranularity ?? 'day'
  const keyExpr =
    kind === 'date'
      ? bucketExpr(raw, granularity, 'UTC')
      : kind === 'datetime'
        ? bucketExpr(raw, granularity, params.timezone)
        : sql`(${raw})::text`

  const dir = groupBy.desc ? sql.raw('DESC') : sql.raw('ASC')
  const ordered = (expr: SQL) => sql`${expr} ${dir} NULLS LAST`

  const rankFor = (key: SQL): SQL | undefined => {
    switch (kind) {
      case 'select':
        return sql`array_position(${textArray(optionOrderKeys(field))}, ${key})`
      case 'actor':
        return sql`array_position(${textArray(params.actorOrder ?? [])}, ${key})`
      case 'relationship':
        return sql`(SELECT "grp_ei"."displayName" FROM "EntityInstance" "grp_ei" WHERE "grp_ei"."id" = ${key})`
      default:
        // Checkbox ('false' < 'true') and date buckets ('YYYY-MM-DD') order by the key itself.
        return undefined
    }
  }

  // The raw key always closes the order so equal ranks (two records named alike) never interleave.
  const orderByKey = (key: SQL): SQL[] => {
    const rank = rankFor(key)
    return rank ? [ordered(rank), ordered(key)] : [ordered(key)]
  }

  return { field, keyExpr, orderBy: orderByKey(keyExpr), orderByKey }
}

/**
 * Resolve, validate and build a group order in one step: the entry point both
 * the list and the summary use, so the two can never order groups differently.
 */
export async function resolveGroupOrder(params: {
  organizationId: string
  groupBy: GroupByInput
  context: EntityQueryContext
  timezone?: string
}): Promise<GroupOrder> {
  const { groupBy, context } = params
  const field = resolveGroupField(groupBy.fieldId, context)
  const kind = groupKind(field)

  const timezone = params.timezone ?? 'UTC'
  if (kind === 'datetime') {
    if (!params.timezone) {
      throw new UnprocessableEntityError('A timezone is required to group by a date-time field')
    }
    assertValidTimezone(timezone)
  }

  const actorOrder = kind === 'actor' ? await loadActorGroupOrder(params.organizationId) : undefined
  return buildGroupOrderBy({ field, groupBy, context, timezone, actorOrder })
}

/**
 * `WHERE` fragment dropping collapsed groups. `NOT (k = ANY(...))` alone would also
 * drop the null group (NULL comparisons are never true), hence the explicit arms.
 */
export function excludeGroupKeysWhere(keyExpr: SQL, keys: readonly string[]): SQL | undefined {
  if (keys.length === 0) return undefined
  const excludeEmpty = keys.includes(EMPTY_GROUP_KEY)
  const realKeys = [...new Set(keys.filter((k) => k !== EMPTY_GROUP_KEY))]
  if (realKeys.length === 0) return sql`(${keyExpr}) IS NOT NULL`
  const notIn = sql`NOT ((${keyExpr}) = ANY(${textArray(realKeys)}))`
  return excludeEmpty
    ? sql`((${keyExpr}) IS NOT NULL AND ${notIn})`
    : sql`((${keyExpr}) IS NULL OR ${notIn})`
}
