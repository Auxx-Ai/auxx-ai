// packages/lib/src/resources/aggregate/widget-query.ts
//
// Widget configuration + resolved global filters → AggregateQuery, plus the
// drill-down segment helpers. Lives next to the group-expression code so the
// two stay in lockstep. Segment→ConditionGroup translation itself is the
// client-safe `segmentToConditions` in `dashboards/client.ts` — this module
// only builds the `SegmentValue` for a raw group key.

import type { FieldType } from '@auxx/database/types'
import {
  addDays,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { ConditionGroup } from '../../conditions'
import type {
  ChartQueryInput,
  DateGranularity,
  DateRangePreset,
  SegmentValue,
} from '../../dashboards/client'
import { bucketRange } from './date-buckets'
import type { AggregateQuery, TrendSpec } from './types'

/**
 * The viewer's live global-filter state, already resolved: per-def condition
 * groups and an ABSOLUTE date range (presets resolved via
 * {@link resolveDateRangePreset}).
 */
export type ResolvedGlobalFilters = {
  conditions?: Array<{ entityDefinitionId: string; groups: ConditionGroup[] }>
  dateRange?: { from?: Date; to?: Date }
  timezone: string
}

/** Does a global condition entry target this widget's source? */
function sourceMatches(cfg: ChartQueryInput, entityDefinitionId: string): boolean {
  return cfg.source.kind === 'entity'
    ? cfg.source.entityDefinitionId === entityDefinitionId
    : cfg.source.tableId === entityDefinitionId
}

/**
 * Translate a chart/KPI/gauge widget's {@link ChartQueryInput} into an
 * AggregateQuery. Widget filters and matching dashboard conditions concatenate
 * as AND-ed groups; the viewer's date range becomes `dateWindow` bound to the
 * widget's `globalDateFieldRef` (skipped when null/absent — the widget opted out).
 */
export function buildAggregateQueryForWidget(
  cfg: ChartQueryInput,
  global: ResolvedGlobalFilters
): AggregateQuery {
  const filters: ConditionGroup[] = [...(cfg.filters ?? [])]
  for (const entry of global.conditions ?? []) {
    if (sourceMatches(cfg, entry.entityDefinitionId)) filters.push(...entry.groups)
  }

  const dateFieldRef =
    cfg.globalDateFieldRef ?? (cfg.kind === 'kpi' ? cfg.trend?.dateFieldRef : undefined)
  const dateWindow =
    dateFieldRef && global.dateRange && (global.dateRange.from || global.dateRange.to)
      ? { fieldRef: dateFieldRef, from: global.dateRange.from, to: global.dateRange.to }
      : undefined

  const query: AggregateQuery = {
    source: cfg.source,
    metric: cfg.metric,
    filters: filters.length ? filters : undefined,
    dateWindow,
    timezone: global.timezone,
  }

  if (cfg.kind === 'barChart' || cfg.kind === 'lineChart' || cfg.kind === 'pieChart') {
    query.groupBy = cfg.groupBy
    if (cfg.kind !== 'pieChart') query.secondaryGroupBy = cfg.secondaryGroupBy
  }

  return query
}

/** The trend spec for a KPI widget; `undefined` when no trend is configured. */
export function trendSpecForWidget(cfg: ChartQueryInput): TrendSpec | undefined {
  if (cfg.kind !== 'kpi' || !cfg.trend) return undefined
  return { compare: cfg.trend.compare }
}

/**
 * Resolve a `DateRangePreset` into an absolute half-open `[from, to)` range in
 * the viewer's timezone. `allTime` (and absent) → unbounded `{}`.
 */
export function resolveDateRangePreset(
  preset: DateRangePreset | undefined,
  timezone: string,
  now: Date = new Date()
): { from?: Date; to?: Date } {
  if (!preset || preset === 'allTime') return {}

  if (typeof preset === 'object') {
    const from = new Date(preset.from)
    const to = new Date(preset.to)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return {}
    // Custom ranges are date picks: interpret as local days, inclusive end date.
    const fromLocal = startOfDay(toZonedTime(from, timezone))
    const toLocal = addDays(startOfDay(toZonedTime(to, timezone)), 1)
    return { from: fromZonedTime(fromLocal, timezone), to: fromZonedTime(toLocal, timezone) }
  }

  const localNow = toZonedTime(now, timezone)
  const toBound = now

  switch (preset) {
    case 'last7d':
    case 'last30d':
    case 'last90d': {
      const days = preset === 'last7d' ? 7 : preset === 'last30d' ? 30 : 90
      const fromLocal = startOfDay(addDays(localNow, -(days - 1)))
      return { from: fromZonedTime(fromLocal, timezone), to: toBound }
    }
    case 'thisWeek':
      return {
        from: fromZonedTime(startOfWeek(localNow, { weekStartsOn: 1 }), timezone),
        to: toBound,
      }
    case 'thisMonth':
      return { from: fromZonedTime(startOfMonth(localNow), timezone), to: toBound }
    case 'thisQuarter':
      return { from: fromZonedTime(startOfQuarter(localNow), timezone), to: toBound }
    case 'thisYear':
      return { from: fromZonedTime(startOfYear(localNow), timezone), to: toBound }
    default:
      return {}
  }
}

/**
 * Build the `SegmentValue` a clicked group represents, from its RAW key + the
 * group field's storage type. Combine with the client-safe
 * `segmentToConditions(fieldRef, segment)` to get drill-down conditions.
 * Returns `undefined` when the segment can't be expressed as conditions
 * (cyclic date buckets — "all Mondays" has no contiguous range).
 */
export function segmentForGroupKey(params: {
  key: string | null
  fieldType: FieldType
  dateGranularity?: DateGranularity
  timezone: string
}): SegmentValue | undefined {
  const { key, fieldType, dateGranularity, timezone } = params
  if (key === null) return { kind: 'empty' }

  if (dateGranularity) {
    const range = bucketRange(key, dateGranularity, timezone)
    if (!range) return undefined
    return { kind: 'dateBucket', from: range.from.toISOString(), to: range.to.toISOString() }
  }

  if (fieldType === 'SINGLE_SELECT' || fieldType === 'MULTI_SELECT' || fieldType === 'TAGS') {
    return { kind: 'option', optionId: key }
  }
  if (fieldType === 'RELATIONSHIP' || fieldType === 'ACTOR') {
    return { kind: 'related', relatedEntityId: key }
  }
  if (fieldType === 'CHECKBOX') {
    return { kind: 'scalar', value: key === 'true' }
  }
  if (fieldType === 'NUMBER' || fieldType === 'CURRENCY') {
    const n = Number(key)
    return { kind: 'scalar', value: Number.isFinite(n) ? n : key }
  }
  return { kind: 'scalar', value: key }
}
