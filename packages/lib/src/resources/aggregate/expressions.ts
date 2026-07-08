// packages/lib/src/resources/aggregate/expressions.ts
//
// SQL expression pieces shared by the entity (EAV) and system (direct-column)
// aggregate builders: typed value-column access and the metric-op switch.
// Identifiers come only from our own registry metadata; values are bind params.

import { getValueColumn } from '@auxx/types/field-value'
import { type SQL, sql } from 'drizzle-orm'
import type { ResolvedFieldRef, ResolvedMetric } from './types'

/** How a resolved field reads in SQL: a real table column, or a FieldValue join alias. */
export type FieldSqlPlan = { kind: 'direct'; column: SQL } | { kind: 'fv'; alias: string }

const DATE_FIELD_TYPES = new Set(['DATE', 'DATETIME', 'TIME'])

/**
 * The typed value expression for a planned field. ACTOR is split storage —
 * user/agent ids live in `actorId`, group ids in `relatedEntityId` — so it
 * reads as a COALESCE over both.
 */
export function valueColExpr(plan: FieldSqlPlan, field: ResolvedFieldRef): SQL {
  if (plan.kind === 'direct') return plan.column
  const a = sql.raw(`"${plan.alias}"`)
  if (field.fieldType === 'ACTOR') {
    return sql`COALESCE(${a}."actorId", ${a}."relatedEntityId")`
  }
  const column = getValueColumn(field.fieldType)
  return sql`${a}.${sql.raw(`"${column}"`)}`
}

/** Whether a field's value is text-typed (affects empty semantics for direct columns). */
function isTextColumn(field: ResolvedFieldRef): boolean {
  return getValueColumn(field.fieldType) === 'valueText'
}

/**
 * The metric aggregate expression. `recordIdCol` is the source table's id
 * column — `count` is always COUNT(DISTINCT id) because multi-value group
 * joins fan rows out. Empty semantics follow the write-path invariant: a
 * cleared FieldValue is a deleted row (`fv.id IS NULL` under LEFT JOIN);
 * direct columns fall back to NULL (and `''` for text).
 */
export function metricExprSql(
  metric: ResolvedMetric,
  plan: FieldSqlPlan | undefined,
  recordIdCol: SQL
): SQL {
  const countRecords = sql`COUNT(DISTINCT ${recordIdCol})`
  if (metric.op === 'count' || !metric.field || !plan) return countRecords

  const field = metric.field
  const col = valueColExpr(plan, field)
  const isDate = DATE_FIELD_TYPES.has(field.fieldType)

  const emptyPred =
    plan.kind === 'fv'
      ? sql`${sql.raw(`"${plan.alias}"`)}."id" IS NULL`
      : isTextColumn(field)
        ? sql`(${col} IS NULL OR ${col} = '')`
        : sql`${col} IS NULL`

  switch (metric.op) {
    case 'sum':
      return sql`SUM(${col})`
    case 'avg':
      return sql`AVG(${col})`
    case 'min':
      return isDate ? sql`MIN(EXTRACT(EPOCH FROM ${col}) * 1000)` : sql`MIN(${col})`
    case 'max':
      return isDate ? sql`MAX(EXTRACT(EPOCH FROM ${col}) * 1000)` : sql`MAX(${col})`
    case 'countUnique':
      return sql`COUNT(DISTINCT ${col})`
    case 'countEmpty':
      return sql`COUNT(DISTINCT ${recordIdCol}) FILTER (WHERE ${emptyPred})`
    case 'countNotEmpty':
      return sql`COUNT(DISTINCT ${recordIdCol}) FILTER (WHERE NOT (${emptyPred}))`
    case 'countTrue':
      return sql`COUNT(DISTINCT ${recordIdCol}) FILTER (WHERE ${col} IS TRUE)`
    case 'countFalse':
      return sql`COUNT(DISTINCT ${recordIdCol}) FILTER (WHERE ${col} IS FALSE)`
    case 'percentEmpty':
      return sql`(COUNT(DISTINCT ${recordIdCol}) FILTER (WHERE ${emptyPred}))::float8 * 100.0 / NULLIF(COUNT(DISTINCT ${recordIdCol}), 0)`
    case 'percentNotEmpty':
      return sql`(COUNT(DISTINCT ${recordIdCol}) FILTER (WHERE NOT (${emptyPred})))::float8 * 100.0 / NULLIF(COUNT(DISTINCT ${recordIdCol}), 0)`
    default:
      return countRecords
  }
}
