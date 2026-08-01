// apps/web/src/components/activity-log/hooks/use-audit-feed.ts
// The data hook behind both audit views. Encapsulates: picking the right query
// (org `list` vs super-admin `listAll`), paging via React Query's infinite query
// (which dedupes pages and resets cleanly on filter change), and filtering loaded
// rows by the client-side search. Both views consume only this hook so their
// pagination/search behavior stays identical.

'use client'

import type { AuditCategory, AuditVisibility } from '@auxx/lib/audit-log/client'
import { useCallback, useMemo } from 'react'
import { api } from '~/trpc/react'
import type { AuditLogRow } from '../types'

/** Filters shared by both scopes; `organizationId`/`visibility` only apply to the admin scope. */
export interface AuditFeedFilters {
  category?: AuditCategory
  from?: Date
  to?: Date
  /** super-admin only — `null` targets platform-level rows, `undefined` = all orgs. */
  organizationId?: string | null
  /** super-admin only. */
  visibility?: AuditVisibility
}

interface UseAuditFeedArgs {
  scope: 'org' | 'admin'
  filters: AuditFeedFilters
  /** Substring filter applied to already-loaded rows (action/target/reason). */
  search?: string
  enabled?: boolean
}

const PAGE_SIZE = 50

/**
 * Loads, pages and filters audit-log rows for a view.
 * @returns `{ rows, isLoading, isRefetching, hasMore, loadMore, refresh, error }`
 */
export function useAuditFeed({ scope, filters, search, enabled = true }: UseAuditFeedArgs) {
  const isOrg = scope === 'org'

  // React Query owns the cursor: pages accumulate in `data.pages`, keyed by the input
  // (filters). Changing filters spins up a fresh paginated query — no manual reset, and
  // no double-append races from accumulating in an effect.
  const orgQuery = api.auditLog.list.useInfiniteQuery(
    { category: filters.category, from: filters.from, to: filters.to, limit: PAGE_SIZE },
    {
      enabled: enabled && isOrg,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    }
  )

  const adminQuery = api.auditLog.listAll.useInfiniteQuery(
    {
      category: filters.category,
      from: filters.from,
      to: filters.to,
      organizationId: filters.organizationId,
      visibility: filters.visibility,
      limit: PAGE_SIZE,
    },
    {
      enabled: enabled && !isOrg,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    }
  )

  const q = isOrg ? orgQuery : adminQuery

  const rows = useMemo<AuditLogRow[]>(
    () => q.data?.pages.flatMap((page) => page.items) ?? [],
    [q.data]
  )

  const loadMore = useCallback(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()
  }, [q])

  // Swallow the argument: consumers wire this straight to `onClick`, and passing a MouseEvent
  // where `refetch` expects `RefetchOptions` is meaningless.
  const refresh = useCallback(() => {
    void q.refetch()
  }, [q.refetch])

  // Client-side text filter over loaded rows only (see plan §4 "Search semantics").
  const filteredRows = useMemo(() => {
    const term = search?.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((row) =>
      [row.action, row.targetType, row.targetId, row.reason]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term))
    )
  }, [rows, search])

  return {
    rows: filteredRows,
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    isLoadingMore: q.isFetchingNextPage,
    hasMore: !!q.hasNextPage,
    loadMore,
    refresh,
    error: q.error ?? null,
  }
}
