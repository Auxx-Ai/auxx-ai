// apps/web/src/components/dashboard/hooks/use-record-list-data.ts
'use client'

// Fetches the id page for a record-list widget via `record.listFiltered`
// (existing endpoint, oneshot — no snapshot needed for a ≤50-row widget page).
// Returns BRANDED RecordIds; the row cells (`RecordBadge` / `CustomFieldCell`)
// self-hydrate field values + display names through the app-wide record batch
// fetcher, so no separate `fieldValue.batchGet` stitching is needed here (same
// path the records table uses).
//
// TODO(global-filters): only the widget's own `filters` are applied today. The
// dashboard global date-range/condition merge (plan 08's URL filter bar) has no
// live producer yet; wire it here alongside the chart hooks once it lands.

import {
  DEFAULT_RECORD_LIST_PAGE_SIZE,
  MAX_RECORD_LIST_PAGE_SIZE,
  type RecordListConfig,
} from '@auxx/lib/dashboards/client'
import { toRecordId } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api } from '~/trpc/react'
import { useDashboardStore } from '../stores/dashboard-draft-store'

/** The entity def id / system table id the widget's source points at. */
function sourceId(config: RecordListConfig): string {
  return config.source.kind === 'entity' ? config.source.entityDefinitionId : config.source.tableId
}

export function useRecordListData(config: RecordListConfig, _widgetId?: string) {
  const dashboardId = useDashboardStore((s) => s.dashboardId)
  const entityDefinitionId = config.source ? sourceId(config) : ''

  const pageSize = Math.min(
    config.pageSize ?? DEFAULT_RECORD_LIST_PAGE_SIZE,
    MAX_RECORD_LIST_PAGE_SIZE
  )

  // listFiltered `sorting.id` is a plain string — only direct ResourceFieldId
  // sorts are supported (one-hop path sorts are out of scope for v1).
  const sorting =
    config.sort && typeof config.sort.fieldRef === 'string'
      ? [{ id: config.sort.fieldRef, desc: config.sort.desc }]
      : undefined

  const query = api.record.listFiltered.useQuery(
    { entityDefinitionId, filters: config.filters, sorting, limit: pageSize },
    {
      enabled: Boolean(dashboardId) && Boolean(config.source),
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  )

  const recordIds = useMemo<RecordId[]>(
    () => (query.data?.ids ?? []).map((id) => toRecordId(entityDefinitionId, id)),
    [query.data?.ids, entityDefinitionId]
  )

  return {
    entityDefinitionId,
    /** Raw entity-instance ids (the `{ id }` rows the DynamicTable renders). */
    ids: query.data?.ids ?? [],
    recordIds,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
