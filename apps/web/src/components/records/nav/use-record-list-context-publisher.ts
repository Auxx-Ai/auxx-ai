// apps/web/src/components/records/nav/use-record-list-context-publisher.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { useEffect } from 'react'
import { useRecordListContextStore } from './record-list-context-store'

interface UseRecordListContextPublisherOptions {
  entityDefinitionId: string | undefined
  tableId: string
  /** The merged filters actually sent to `record.listFiltered`. */
  filters: ConditionGroup[] | undefined
  /** The free-text `search` actually sent alongside them (plan decision 0.3). */
  search?: string
  sorting: Array<{ id: string; desc: boolean }> | undefined
  viewId: string | null
  label: string | undefined
  /** Loaded ids in display order. */
  ids: string[]
  /** False while the table's own config is still hydrating. */
  enabled: boolean
}

const EMPTY_FILTERS: ConditionGroup[] = []
const EMPTY_SORTING: Array<{ id: string; desc: boolean }> = []

/**
 * Publish the list a surface is currently showing, so a detail page opened from
 * it can walk the same records in the same order.
 *
 * Mounted once inside `DynamicResourceView`, which is the only place that holds
 * the merged filters, the sorting and the loaded ids together. Capturing there
 * means no navigation call site has to be touched — the primary cell's "Open
 * full page", the drawer's fullscreen button and a pasted link all inherit it.
 *
 * The store de-dupes identical captures, so the effect firing on every table
 * render is cheap.
 */
export function useRecordListContextPublisher({
  entityDefinitionId,
  tableId,
  filters,
  search,
  sorting,
  viewId,
  label,
  ids,
  enabled,
}: UseRecordListContextPublisherOptions): void {
  const capture = useRecordListContextStore((s) => s.capture)

  useEffect(() => {
    if (!enabled || !entityDefinitionId || ids.length === 0) return
    capture(
      {
        entityDefinitionId,
        filters: filters ?? EMPTY_FILTERS,
        search,
        sorting: sorting ?? EMPTY_SORTING,
        tableId,
        viewId,
        label: label ?? 'List',
      },
      ids
    )
  }, [capture, enabled, entityDefinitionId, filters, search, sorting, tableId, viewId, label, ids])
}
