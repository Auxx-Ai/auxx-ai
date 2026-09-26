// packages/lib/src/resources/grouping/group-summary.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { ResourceFieldId } from '@auxx/types/field'
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { ConditionGroup } from '../../conditions'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { type FieldSqlPlan, metricExprSql } from '../aggregate/expressions'
import {
  buildEntityInstanceQueryParts,
  reportDroppedConditions,
} from '../crud/unified-handler-queries'
import {
  type EntityQueryContext,
  entityConditionBuilder,
} from '../query-builder/entity-condition-builder'
import { isAggregatableField } from './client'
import { directColumn } from './group-order'
import {
  type GroupAggregatesInput,
  type GroupByInput,
  type GroupSummaryResult,
  MAX_SUMMARY_GROUPS,
} from './types'

type SummaryRow = { key: unknown; count: unknown } & Record<string, unknown>

interface PlannedAggregate {
  columnId: string
  alias: string
  expr: SQL
  join?: SQL
}

function planAggregates(
  aggregates: GroupAggregatesInput,
  context: EntityQueryContext,
  entityDefinitionId: string
): Result<PlannedAggregate[], Error> {
  const planned: PlannedAggregate[] = []
  const idCol = sql`${schema.EntityInstance.id}`
  let seq = 0

  for (const [columnId, op] of Object.entries(aggregates)) {
    const field = columnId.includes('::')
      ? undefined
      : entityConditionBuilder.resolveFieldRef(columnId, context)
    // CALC is refused alongside ineligible fields: its values are computed, not stored.
    if (!field || field.fieldType === 'CALC' || !isAggregatableField(field)) {
      return err(new UnprocessableEntityError(`Column '${columnId}' cannot be summarized`))
    }

    const alias = `a_${seq}`
    const direct = directColumn(field, context)
    let plan: FieldSqlPlan
    let join: SQL | undefined
    if (direct) {
      plan = { kind: 'direct', column: sql`${direct}` }
    } else {
      const fvAlias = `fv_${seq}`
      const a = sql.raw(`"${fvAlias}"`)
      // Single-valued by eligibility, so the join never fans rows out and COUNT(*) stays exact.
      join = sql`LEFT JOIN "FieldValue" ${a} ON ${a}."entityId" = ${idCol} AND ${a}."fieldId" = ${field.id}`
      plan = { kind: 'fv', alias: fvAlias }
    }
    seq++

    const expr = metricExprSql(
      {
        op,
        field: {
          ref: columnId as ResourceFieldId,
          field,
          entityDefinitionId,
          fieldType: field.fieldType as FieldType,
        },
      },
      plan,
      idCol
    )
    planned.push({ columnId, alias, expr: sql`(${expr})::float8`, join })
  }
  return ok(planned)
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Per-group record counts and column aggregates for a grouped table, in the
 * list's group order. Shares the list's WHERE (filters, search and the member's
 * `visibilityWhere`) so counts never include rows the member cannot open.
 */
export async function queryEntityGroupSummary(
  db: Database | Transaction,
  params: {
    entityDefinitionId: string
    organizationId: string
    filters: ConditionGroup[]
    search?: string
    groupBy: GroupByInput
    timezone?: string
    aggregates?: GroupAggregatesInput
    /** The §5.1 per-record visibility predicate; see `queryEntityInstanceIdsPaged`. */
    visibilityWhere?: SQL
  }
): Promise<Result<GroupSummaryResult, Error>> {
  const { entityDefinitionId, organizationId } = params

  let parts: Awaited<ReturnType<typeof buildEntityInstanceQueryParts>>
  try {
    parts = await buildEntityInstanceQueryParts({
      organizationId,
      entityDefinitionId,
      filters: params.filters,
      sorting: [],
      search: params.search,
      groupBy: params.groupBy,
      timezone: params.timezone,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    throw error
  }
  const { whereClause, groupKeyExpr, groupOrderByKey, context, dropped } = parts
  if (!groupKeyExpr || !groupOrderByKey) {
    return err(new UnprocessableEntityError('A group field is required'))
  }

  const planned = planAggregates(params.aggregates ?? {}, context, entityDefinitionId)
  if (planned.isErr()) return err(planned.error)

  const baseWhere = and(
    eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
    eq(schema.EntityInstance.organizationId, organizationId),
    isNull(schema.EntityInstance.archivedAt),
    whereClause,
    params.visibilityWhere
  ) as SQL

  const innerCols: SQL[] = [
    sql`${groupKeyExpr} AS "key"`,
    sql`COUNT(*)::int AS "count"`,
    ...planned.value.map((p) => sql`${p.expr} AS ${sql.raw(`"${p.alias}"`)}`),
  ]
  const joins = planned.value.flatMap((p) => (p.join ? [p.join] : []))

  // Grouped in a subquery so the outer ORDER BY can rank by the computed key;
  // the cap then keeps the groups the list shows first.
  const query = sql`SELECT * FROM (
    SELECT ${sql.join(innerCols, sql`, `)}
    FROM ${schema.EntityInstance} ${sql.join(joins, sql` `)}
    WHERE ${baseWhere}
    GROUP BY 1
  ) "grp"
  ORDER BY ${sql.join(groupOrderByKey(sql`"grp"."key"`), sql`, `)}
  LIMIT ${MAX_SUMMARY_GROUPS + 1}`

  // Raw: a grouped aggregate over the EAV joins has no query-builder equivalent.
  const result = await db.execute(query)
  const rows = (result as unknown as { rows: SummaryRow[] }).rows ?? []

  return ok({
    groups: rows.slice(0, MAX_SUMMARY_GROUPS).map((row) => ({
      key: row.key === null || row.key === undefined ? null : String(row.key),
      count: Number(row.count ?? 0),
      aggregates: Object.fromEntries(
        planned.value.map((p) => [p.columnId, toNumberOrNull(row[p.alias])])
      ),
    })),
    hasMoreGroups: rows.length > MAX_SUMMARY_GROUPS,
    ...reportDroppedConditions(dropped),
  })
}
