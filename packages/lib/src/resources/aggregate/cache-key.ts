// packages/lib/src/resources/aggregate/cache-key.ts
//
// Pure cache-key derivation for the aggregate result cache. Callers MUST pass
// the query with filters already run through `resolveConditionContext` — that
// is what makes `{{me}}` placeholders fork keys per viewer while everything
// else shares across users (aggregates have no row-level permissions).
// The identity object is normalized to JSON primitives — Dates → ISO strings,
// absent optionals → null — so the hash can't fork on undefined-vs-missing or
// on Date serialization quirks.
//
// Anything added to `AggregateQuery` later MUST either join this identity or
// be provably display-irrelevant.

import { stableHash } from '@auxx/utils/hash'
import type { Condition, ConditionGroup } from '../../conditions'
import type { GroupBy, TrendCompare } from '../../dashboards/client'
import type { AggregateQuery } from './types'

/** Drop per-condition UI bookkeeping (ids, metadata) — it never affects results. */
function conditionIdentity(c: Condition): Record<string, unknown> {
  const { id: _id, metadata: _metadata, subConditions, ...rest } = c
  return {
    ...rest,
    subConditions: subConditions?.length ? subConditions.map(conditionIdentity) : null,
  }
}

function filterIdentity(groups: ConditionGroup[]): unknown[] {
  return groups.map((g) => ({
    logicalOperator: g.logicalOperator,
    conditions: g.conditions.map(conditionIdentity),
  }))
}

function groupIdentity(g: GroupBy | undefined) {
  if (!g) return null
  return {
    fieldRef: g.fieldRef,
    dateGranularity: g.dateGranularity ?? null,
    sort: g.sort ?? null,
    limit: g.limit ?? null,
    omitEmpty: g.omitEmpty ?? null,
  }
}

/**
 * Cache key for one aggregate run: `{orgId}:{sha256}`. The org prefix keeps a
 * per-org flush possible via pattern invalidation.
 */
export function aggregateCacheKey(params: {
  kind: 'agg' | 'kpi'
  organizationId: string
  /** Query with filters ALREADY context-resolved (viewer placeholders substituted). */
  query: AggregateQuery
  /** KPI trend comparison — forks the key because it derives a second window. */
  compare?: TrendCompare | null
}): string {
  const { kind, organizationId, query, compare } = params
  const identity = {
    kind,
    source: query.source,
    metric: { op: query.metric.op, fieldRef: query.metric.fieldRef ?? null },
    groupBy: groupIdentity(query.groupBy),
    secondaryGroupBy: groupIdentity(query.secondaryGroupBy),
    filters: filterIdentity(query.filters ?? []),
    dateWindow: query.dateWindow
      ? {
          fieldRef: query.dateWindow.fieldRef,
          from: query.dateWindow.from?.toISOString() ?? null,
          to: query.dateWindow.to?.toISOString() ?? null,
        }
      : null,
    timezone: query.timezone || 'UTC',
    limit: query.limit ?? null,
    compare: compare ?? null,
  }
  return `${organizationId}:${stableHash(identity)}`
}
