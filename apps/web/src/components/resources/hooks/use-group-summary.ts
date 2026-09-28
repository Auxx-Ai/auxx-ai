// apps/web/src/components/resources/hooks/use-group-summary.ts

import type { ColumnAggregateOp, ConditionGroup, GroupByConfig } from '@auxx/lib/conditions/client'
import { skipToken } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import { useNormalizedDefinitionId } from '../utils/normalize-record-id'

/** Count and per-column aggregates for one group. */
export interface GroupSummaryValue {
  count: number
  aggregates: Record<string, number | null>
}

interface UseGroupSummaryOptions {
  entityDefinitionId: string
  filters?: ConditionGroup[]
  search?: string
  /** No query runs while this is undefined. */
  groupBy?: GroupByConfig
  timezone?: string
  /** Column id (ResourceFieldId) → op; callers pass only aggregatable columns. */
  aggregates?: Record<string, ColumnAggregateOp>
  enabled?: boolean
  /** `useRecordList().listRefetchedAt` — every list refetch re-pulls the counts. */
  listRefetchedAt?: number
}

interface UseGroupSummaryResult {
  summary: Map<string | null, GroupSummaryValue> | undefined
  /** Keys in the list's group order ("No value" last). */
  orderedKeys: Array<string | null> | undefined
  hasMoreGroups: boolean
  error: unknown
  isLoading: boolean
}

/** `groupBy.fieldId` inside a tRPC query key (`[path, { input, type }]`). */
function groupFieldOf(queryKey: readonly unknown[] | undefined): string | undefined {
  const meta = queryKey?.[1] as { input?: { groupBy?: { fieldId?: string } } } | undefined
  return meta?.input?.groupBy?.fieldId
}

/**
 * Per-group counts and aggregates for a grouped table (plans/table/group-by-plan.md §5.1).
 * Shares filters/search with `useRecordList`, so counts match what the list can load.
 */
export function useGroupSummary({
  entityDefinitionId: rawEntityDefinitionId,
  filters,
  search,
  groupBy,
  timezone,
  aggregates,
  enabled = true,
  listRefetchedAt = 0,
}: UseGroupSummaryOptions): UseGroupSummaryResult {
  const entityDefinitionId = useNormalizedDefinitionId(rawEntityDefinitionId)
  const utils = api.useUtils()

  // Whatever refetched the list (merge, import, an action's invalidate) also changed the
  // counts; following the list is what keeps the ~16 `listFiltered.invalidate` call sites honest.
  useEffect(() => {
    if (!listRefetchedAt || !groupBy || !entityDefinitionId) return
    void utils.record.groupSummary.invalidate({ entityDefinitionId })
  }, [listRefetchedAt, groupBy, entityDefinitionId, utils])

  // Key order must match `useRecordList`'s summary partial input so its optimistic writes land.
  const input = useMemo(
    () =>
      groupBy
        ? {
            entityDefinitionId,
            filters: filters && filters.length > 0 ? filters : undefined,
            search: search || undefined,
            groupBy,
            timezone,
            aggregates: aggregates && Object.keys(aggregates).length > 0 ? aggregates : undefined,
          }
        : undefined,
    [entityDefinitionId, filters, search, groupBy, timezone, aggregates]
  )

  const query = api.record.groupSummary.useQuery(
    enabled && input && entityDefinitionId ? input : skipToken,
    {
      staleTime: 30_000,
      // Headers keep their counts while a filter/aggregate change refetches — but not across a
      // group-field change, where the old keys would label the new groups.
      placeholderData: (previous, previousQuery) =>
        groupFieldOf(previousQuery?.queryKey) === groupBy?.fieldId ? previous : undefined,
      retry: false,
    }
  )

  const data = input ? query.data : undefined

  const { summary, orderedKeys } = useMemo(() => {
    if (!data) return { summary: undefined, orderedKeys: undefined }
    const map = new Map<string | null, GroupSummaryValue>()
    for (const group of data.groups) {
      map.set(group.key, { count: group.count, aggregates: group.aggregates })
    }
    return { summary: map, orderedKeys: data.groups.map((group) => group.key) }
  }, [data])

  return {
    summary,
    orderedKeys,
    hasMoreGroups: data?.hasMoreGroups ?? false,
    error: input ? query.error : null,
    isLoading: !!input && query.isLoading,
  }
}
