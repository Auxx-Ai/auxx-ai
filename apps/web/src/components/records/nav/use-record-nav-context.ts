// apps/web/src/components/records/nav/use-record-nav-context.ts
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import { useViewStoreInitialized } from '~/components/dynamic-table/stores/store-selectors'
import type { TableView, ViewConfig } from '~/components/dynamic-table/types'
import { useResource } from '~/components/resources'
import { getRecordLink } from '~/components/resources/utils/get-record-link'
import { api } from '~/trpc/react'
import {
  type RecordListDescriptor,
  useRecordListContext,
  useRecordListContextStore,
} from './record-list-context-store'

/** Page size when extending a list we already have rows for. */
const PAGE_SIZE = 100
/**
 * Page size for the FIRST fetch of a reconstructed list. A deep link has no
 * captured ids, so this single window is the only chance to locate the open
 * record's index without walking dozens of pages — see the plan's "cold-start
 * index problem". 500 is `record.listFiltered`'s ceiling.
 */
const COLD_PAGE_SIZE = 500
/** Distance from the loaded edge at which we start pulling the next page. */
const PREFETCH_MARGIN = 5

const EMPTY_FILTERS: ConditionGroup[] = []
const EMPTY_SORTING: Array<{ id: string; desc: boolean }> = []

export interface RecordNavContext {
  descriptor: RecordListDescriptor
  /** Loaded ids in list order. Append-only for the life of a descriptor. */
  ids: string[]
  /** Position of the open record, or -1 when it is not in the list. */
  index: number
  /** Total matching rows, when the server reported one (first page only). */
  total: number
  hasPrev: boolean
  hasNext: boolean
  goPrev: () => void
  goNext: () => void
  /** Navigate to any record of this definition, preserving the query string. */
  goTo: (entityInstanceId: string) => void
  /** Pull the next page. The switcher calls this on scroll-end. */
  loadMore: () => void
  hasMore: boolean
  isLoadingMore: boolean
  /**
   * True when the descriptor was rebuilt from the `?list=` token or the def's
   * default view rather than captured from a real table. Ad-hoc search-bar
   * conditions are lost in that case, which is why the popover names the list.
   */
  isReconstructed: boolean
  /** Swap to a different saved view of the same definition. */
  selectView: (view: TableView) => void
}

/** Build a descriptor from a saved view row. */
function descriptorFromView(
  entityDefinitionId: string,
  tableId: string,
  view: TableView,
  filters: ConditionGroup[] | undefined,
  sorting: Array<{ id: string; desc: boolean }> | undefined
): RecordListDescriptor {
  return {
    entityDefinitionId,
    filters: filters ?? (view.config as ViewConfig)?.filters ?? EMPTY_FILTERS,
    sorting: sorting ?? (view.config as ViewConfig)?.sorting ?? EMPTY_SORTING,
    tableId,
    viewId: view.id,
    label: view.name,
  }
}

/**
 * Resolve which list the open record belongs to, and expose prev/next over it.
 *
 * Resolution order — first hit wins:
 *   1. The descriptor captured by a table this session (authoritative: it carries
 *      the search bar and any unsaved filter/sort overlays).
 *   2. `?list=v:<viewId>` from the URL — a reload or a shared link.
 *   3. The definition's default saved view — arrived from a relationship cell,
 *      Kopilot, a dashboard widget or mail.
 *   4. Nothing → returns `null`, and the caller renders a plain breadcrumb.
 *
 * Returns `null` while the view store is still hydrating, so a cold load shows
 * the static label rather than flashing an empty switcher.
 */
export function useRecordNavContext(recordId: RecordId): RecordNavContext | null {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  const tableId = `entity-${entityDefinitionId}`

  const router = useRouter()
  const searchParams = useSearchParams()
  const utils = api.useUtils()
  const { resource } = useResource(entityDefinitionId)

  const storeInitialized = useViewStoreInitialized()
  const captured = useRecordListContext(entityDefinitionId)
  const capture = useRecordListContextStore((s) => s.capture)
  const [listToken, setListToken] = useQueryState('list', { history: 'replace' })

  // ─── RESOLVE THE DESCRIPTOR ──────────────────────────────────────────────
  // Views for this definition's table, plus the raw filter/sort slices, so a
  // reconstructed descriptor matches what the table itself would have run.
  const views = useDynamicTableStore((s) => s.viewsByTableId[tableId])
  const viewFilters = useDynamicTableStore((s) => s.viewFilters)
  const viewConfigs = useDynamicTableStore((s) => s.viewConfigs)

  const tokenViewId = listToken?.startsWith('v:') ? listToken.slice(2) : null

  const resolved = useMemo((): {
    descriptor: RecordListDescriptor
    reconstructed: boolean
  } | null => {
    // 1 — captured from a real table this session.
    if (captured) return { descriptor: captured.descriptor, reconstructed: false }
    if (!storeInitialized) return null

    const candidates = views ?? []
    // 2 — the URL token.
    const fromToken = tokenViewId ? candidates.find((v) => v.id === tokenViewId) : undefined
    // 3 — the definition's default view. Prefer the org default; fall back to
    //     any personal default, then to the first view that exists.
    const fallback =
      candidates.find((v) => v.isDefault && v.isShared) ??
      candidates.find((v) => v.isDefault) ??
      candidates[0]

    const view = fromToken ?? fallback
    if (!view) return null

    return {
      descriptor: descriptorFromView(
        entityDefinitionId,
        tableId,
        view,
        viewFilters[view.id],
        viewConfigs[view.id]?.sorting
      ),
      reconstructed: true,
    }
  }, [
    captured,
    storeInitialized,
    views,
    tokenViewId,
    viewFilters,
    viewConfigs,
    entityDefinitionId,
    tableId,
  ])

  const descriptor = resolved?.descriptor ?? null
  const isReconstructed = resolved?.reconstructed ?? false

  // Identity of the current list. Everything below resets when it changes.
  const descriptorKey = useMemo(
    () =>
      descriptor
        ? JSON.stringify([descriptor.entityDefinitionId, descriptor.filters, descriptor.sorting])
        : null,
    [descriptor]
  )

  // ─── IDS: APPEND-ONLY ────────────────────────────────────────────────────
  // Membership and order freeze on entry; paging appends. A record edited out of
  // the filter it was found under must not vanish from under the arrows.
  const [ids, setIds] = useState<string[]>(() => captured?.ids ?? [])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const idsRef = useRef(ids)
  idsRef.current = ids
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore
  const loadingRef = useRef(false)
  const seededKeyRef = useRef<string | null>(null)

  // Reset on a genuinely different list — not on a data refetch.
  useEffect(() => {
    if (descriptorKey === null || seededKeyRef.current === descriptorKey) return
    seededKeyRef.current = descriptorKey
    const seed = captured?.ids ?? []
    setIds(seed)
    setTotal(0)
    setHasMore(true)
    loadingRef.current = false
  }, [descriptorKey, captured?.ids])

  const loadMore = useCallback(() => {
    if (!descriptor || loadingRef.current || !hasMoreRef.current) return
    loadingRef.current = true
    setIsLoadingMore(true)
    const offset = idsRef.current.length
    void utils.record.listFiltered
      .fetch({
        entityDefinitionId: descriptor.entityDefinitionId,
        filters: descriptor.filters.length > 0 ? descriptor.filters : undefined,
        sorting: descriptor.sorting.length > 0 ? descriptor.sorting : undefined,
        limit: offset === 0 ? COLD_PAGE_SIZE : PAGE_SIZE,
        offset,
      })
      .then((result) => {
        setIds((prev) => {
          const seen = new Set(prev)
          const next = [...prev]
          for (const id of result.ids) {
            if (!seen.has(id)) next.push(id)
          }
          return next
        })
        // `total` rides on the first page only — the server skips the COUNT for
        // offset > 0, so a later page must not clobber it with 0.
        if (typeof result.total === 'number' && result.total > 0) setTotal(result.total)
        setHasMore(result.hasMore)
      })
      .finally(() => {
        loadingRef.current = false
        setIsLoadingMore(false)
      })
  }, [descriptor, utils])

  // Initial fill for a reconstructed list — nothing captured it, so ask for the
  // one wide window that decides whether the arrows can work at all.
  useEffect(() => {
    if (!descriptor || ids.length > 0 || !hasMore || loadingRef.current) return
    loadMore()
  }, [descriptor, ids.length, hasMore, loadMore])

  const index = useMemo(() => ids.indexOf(entityInstanceId), [ids, entityInstanceId])

  // Pull the next page before the user reaches the edge, so holding J does not
  // stall at row 100.
  useEffect(() => {
    if (index < 0 || !hasMore) return
    if (index >= ids.length - PREFETCH_MARGIN) loadMore()
  }, [index, ids.length, hasMore, loadMore])

  // ─── NAVIGATION ──────────────────────────────────────────────────────────
  const goTo = useCallback(
    (targetInstanceId: string) => {
      if (!targetInstanceId || !resource) return
      const href = getRecordLink(toRecordId(entityDefinitionId, targetInstanceId), resource)
      if (!href) return
      // Carry the whole query string across the hop — losing `?tab=` on every
      // arrow press would be the most irritating possible regression here.
      const qs = searchParams.toString()
      router.push(qs ? `${href}?${qs}` : href)
    },
    [resource, entityDefinitionId, router, searchParams]
  )

  const hasPrev = index > 0
  const hasNext = index >= 0 && index < ids.length - 1

  const goPrev = useCallback(() => {
    const target = hasPrev ? ids[index - 1] : undefined
    if (target) goTo(target)
  }, [hasPrev, goTo, ids, index])

  const goNext = useCallback(() => {
    const target = hasNext ? ids[index + 1] : undefined
    if (target) goTo(target)
  }, [hasNext, goTo, ids, index])

  // ─── SWITCHING LISTS ─────────────────────────────────────────────────────
  const selectView = useCallback(
    (view: TableView) => {
      const next = descriptorFromView(
        entityDefinitionId,
        tableId,
        view,
        viewFilters[view.id],
        viewConfigs[view.id]?.sorting
      )
      // Capture with no ids: the picked view has never been rendered here, so
      // the seed effect refills it from the server.
      capture(next, [])
      void setListToken(`v:${view.id}`)
    },
    [entityDefinitionId, tableId, viewFilters, viewConfigs, capture, setListToken]
  )

  // ─── THE `?list=` TOKEN ──────────────────────────────────────────────────
  // Written here rather than at every navigation call site. Only descriptors
  // backed by a saved view are reconstructable; a token for a session-filtered
  // list would lie about what reload restores, so those write nothing.
  const desiredToken = descriptor?.viewId ? `v:${descriptor.viewId}` : null
  useEffect(() => {
    if (!desiredToken || listToken === desiredToken) return
    void setListToken(desiredToken)
  }, [desiredToken, listToken, setListToken])

  if (!descriptor) return null

  return {
    descriptor,
    ids,
    index,
    total: total || ids.length,
    hasPrev,
    hasNext,
    goPrev,
    goNext,
    goTo,
    loadMore,
    hasMore,
    isLoadingMore,
    isReconstructed,
    selectView,
  }
}
