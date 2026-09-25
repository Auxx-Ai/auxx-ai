// apps/web/src/components/mrp/hooks/use-mrp-filters.ts

'use client'

import {
  MRP_LIST_SORTS,
  MRP_PLAN_TABS,
  MRP_SUGGESTION_KINDS,
  MRP_SUPPLY_TYPES,
  type MrpListSort,
  type MrpPlanTab,
  type MrpSuggestionKind,
  type MrpSupplyType,
} from '@auxx/lib/mrp/client'
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from 'nuqs'
import { useCallback, useMemo } from 'react'

export const MRP_GROUP_BYS = ['none', 'supplier', 'finished_good'] as const
export type MrpGroupBy = (typeof MRP_GROUP_BYS)[number]

export const MRP_DIRECTIONS = ['asc', 'desc'] as const
export type MrpDirection = (typeof MRP_DIRECTIONS)[number]

export interface MrpFilters {
  tab: MrpPlanTab
  search: string
  supplyType: MrpSupplyType[]
  suggestionKind: MrpSuggestionKind[]
  supplierIds: string[]
  /** null reads as either. */
  buffered: boolean | null
  groupBy: MrpGroupBy
  sort: MrpListSort
  direction: MrpDirection
}

export interface UseMrpFilters {
  filters: MrpFilters
  setFilters: (patch: Partial<MrpFilters>) => void
  /** Resets the narrowing filters; tab, grouping and order are view choices and survive. */
  clear: () => void
  isDirty: boolean
}

/** True when any narrowing filter is set; the view choices never count. */
export function isMrpFiltered(filters: MrpFilters): boolean {
  return !!(
    filters.search.trim() ||
    filters.supplyType.length ||
    filters.suggestionKind.length ||
    filters.supplierIds.length ||
    filters.buffered !== null
  )
}

/** `mrp.list`'s input for these filters; `search` is passed in so the caller can debounce it. */
export function mrpListInput(
  filters: MrpFilters,
  options: { runId?: string | null; search?: string; limit?: number } = {}
) {
  const search = (options.search ?? filters.search).trim()
  return {
    runId: options.runId ?? null,
    tab: filters.tab,
    search: search || undefined,
    supplyType: filters.supplyType.length ? filters.supplyType : undefined,
    suggestionKind: filters.suggestionKind.length ? filters.suggestionKind : undefined,
    supplierIds: filters.supplierIds.length ? filters.supplierIds : undefined,
    buffered: filters.buffered ?? undefined,
    sort: filters.sort,
    direction: filters.direction,
    limit: options.limit,
  }
}

/** The MRP list pages' toolbar state in `nuqs`, so a filtered view is a shareable link. */
export function useMrpFilters(options: { defaultTab?: MrpPlanTab } = {}): UseMrpFilters {
  const defaultTab = options.defaultTab ?? 'overdue'
  const parsers = useMemo(
    () => ({
      tab: parseAsStringLiteral(MRP_PLAN_TABS).withDefault(defaultTab),
      search: parseAsString.withDefault(''),
      supplyType: parseAsArrayOf(parseAsStringLiteral(MRP_SUPPLY_TYPES)).withDefault([]),
      suggestionKind: parseAsArrayOf(parseAsStringLiteral(MRP_SUGGESTION_KINDS)).withDefault([]),
      supplierIds: parseAsArrayOf(parseAsString).withDefault([]),
      buffered: parseAsBoolean,
      groupBy: parseAsStringLiteral(MRP_GROUP_BYS).withDefault('none'),
      sort: parseAsStringLiteral(MRP_LIST_SORTS).withDefault('priority'),
      direction: parseAsStringLiteral(MRP_DIRECTIONS).withDefault('asc'),
    }),
    [defaultTab]
  )
  const [filters, setParams] = useQueryStates(parsers)

  const setFilters = useCallback(
    (patch: Partial<MrpFilters>) => {
      void setParams(patch)
    },
    [setParams]
  )

  const clear = useCallback(() => {
    void setParams({
      search: null,
      supplyType: null,
      suggestionKind: null,
      supplierIds: null,
      buffered: null,
    })
  }, [setParams])

  return { filters, setFilters, clear, isDirty: isMrpFiltered(filters) }
}
