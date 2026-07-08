// packages/lib/src/resources/aggregate/index.ts

export { aggregateCacheKey } from './cache-key'
export {
  bucketRange,
  enumerateBuckets,
  formatBucketLabel,
  isCyclicGranularity,
} from './date-buckets'
export { EMPTY_LABEL, resolveGroupLabels } from './group-labels'
export { type AggregateRunOptions, OTHER_SERIES_KEY, runAggregate, runKpi } from './run-aggregate'
export {
  isSystemAggregateTable,
  SYSTEM_AGGREGATE_TABLE_IDS,
  type SystemAggregateTableId,
} from './system-aggregate-builder'
export { deriveTrendWindows, type TrendWindows } from './trend'
export type {
  AggregateDateWindow,
  AggregateGroup,
  AggregateQuery,
  AggregateResult,
  KpiResult,
  TrendSpec,
} from './types'
export {
  buildAggregateQueryForWidget,
  type ResolvedGlobalFilters,
  resolveDateRangePreset,
  segmentForGroupKey,
  trendSpecForWidget,
} from './widget-query'
