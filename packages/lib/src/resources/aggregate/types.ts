// packages/lib/src/resources/aggregate/types.ts
//
// Server-side type surface for the aggregate engine. The query contract
// (`AggregateQuery`) carries the client-shaped `Metric`/`GroupBy` with BRANDED
// field refs — `run-aggregate.ts` is the single place refs get unwrapped into
// `Resolved*` shapes, which is what the SQL builders consume.

import type { FieldType } from '@auxx/database/types'
import type { ConditionGroup } from '../../conditions'
import type {
  DateGranularity,
  GroupBy,
  GroupSort,
  Metric,
  MetricOp,
  TrendCompare,
  WidgetFieldRef,
  WidgetSource,
} from '../../dashboards/client'
import type { ResourceField } from '../registry/field-types'

// ── Query contract (input) ──────────────────────────────────────────────────

/** Resolved global date range bound to a widget's date field. Half-open [from, to). */
export type AggregateDateWindow = { fieldRef: WidgetFieldRef; from?: Date; to?: Date }

/**
 * One aggregate query — what `widget-query.ts` produces from a widget config
 * and what `runAggregate`/`runKpi` consume. Field refs stay branded here.
 *
 * ⚠️ This type is the result-cache identity surface: any field added here must
 * either join the identity object in `cache-key.ts` or be provably
 * display-irrelevant (display-only config never reaches this type by design).
 */
export type AggregateQuery = {
  /** Entity def or system table. */
  source: WidgetSource
  /** op + optional fieldRef (`count` needs none). */
  metric: Metric
  /** Absent = single-value aggregate (KPI/gauge). */
  groupBy?: GroupBy
  /** Stacked/multi-series dimension. */
  secondaryGroupBy?: GroupBy
  /** Widget + dashboard conditions, already merged (AND-ed groups). */
  filters?: ConditionGroup[]
  /** Resolved global date range. */
  dateWindow?: AggregateDateWindow
  /** Viewer timezone (IANA) for bucketing + window math. Fallback 'UTC'. */
  timezone: string
  /** Group cap. Default {@link DEFAULT_GROUP_LIMIT}, max {@link MAX_GROUP_LIMIT}. */
  limit?: number
}

/** Trend spec for KPI queries: compare the current window against a derived previous one. */
export type TrendSpec = { compare: TrendCompare }

// ── Results (output) ────────────────────────────────────────────────────────

export type AggregateGroup = {
  /** Raw group value (optionId, relatedEntityId, actor id, bucket key, text) — drill-down needs it. */
  key: string | null
  /** Resolved display label ('(empty)' for null). Display-only. */
  label: string
  value: number
  /** Present when the query had a `secondaryGroupBy`. */
  series?: Array<{ key: string | null; label: string; value: number }>
}

export type AggregateResult = {
  groups: AggregateGroup[]
  /** Sum of all group values (before the limit slice). Not meaningful for avg/percent ops. */
  totalValue: number
  /** True when more groups existed than the requested limit. */
  hasMoreGroups: boolean
}

/** `previousValue` filled by the trend run; absent when the window is unbounded. */
export type KpiResult = { value: number; previousValue?: number }

// ── Resolved shapes (internal — builders consume these) ─────────────────────

/**
 * A widget field ref unwrapped against the resource registry. `field` is the
 * field the SQL expression targets; for one-hop paths `hop` is the relationship
 * field on the root def and `field` lives on the hop-target def.
 */
export type ResolvedFieldRef = {
  ref: WidgetFieldRef
  /** Relationship field on the root def (one-hop paths only). */
  hop?: ResourceField
  /** The target field (on the root def, or on the hop-target def). */
  field: ResourceField
  /** Def the target field belongs to. */
  entityDefinitionId: string
  /** Effective storage FieldType (`field.fieldType` or derived from BaseType). */
  fieldType: FieldType
}

export type ResolvedMetric = { op: MetricOp; field?: ResolvedFieldRef }

export type ResolvedGroupBy = {
  field: ResolvedFieldRef
  dateGranularity?: DateGranularity
  sort: GroupSort
  limit: number
  omitEmpty: boolean
}

export type ResolvedDateWindow = { field: ResolvedFieldRef; from?: Date; to?: Date }
