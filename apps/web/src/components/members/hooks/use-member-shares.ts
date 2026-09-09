// apps/web/src/components/members/hooks/use-member-shares.ts
'use client'

import { useCallback, useMemo } from 'react'
import { api, type RouterInputs, type RouterOutputs } from '~/trpc/react'

/** The collapsed first paint: groups, owned counts, and the pinned type grants. */
export type MemberShareSummary = RouterOutputs['member']['shareSummary']
/** One instance-level group row (a resource type, or one record definition). */
export type MemberShareGroup = MemberShareSummary['groups'][number]
/** One counts-only entry in the "Owned by this member" section (§3.2). */
export type MemberShareOwned = MemberShareSummary['owned'][number]
/** One type-level grant — the pinned "Record types" group (decision 8). */
export type MemberShareTypeGrant = MemberShareSummary['typeGrants'][number]
/** One listed share row. */
export type MemberShareItem = RouterOutputs['member']['shares']['items'][number]
/** What a revoke targets: `all`, one type, or an explicit set of record ids (§4.1). */
export type RevokeSharesScope = RouterInputs['member']['revokeShares']['scope']
/** What a revoke reports back — counts plus the rows it declined to touch (§5.2). */
export type RevokeSharesResult = RouterOutputs['member']['revokeShares']

/** Page size, mirroring `MEMBER_SHARES_PAGE_SIZE` (§6.5). */
export const MEMBER_SHARES_PAGE_SIZE = 50

/**
 * The Shared tab's summary, split into the three shapes the tab renders.
 *
 * Type-level rows arrive from the summary as ordinary groups with
 * `kind: 'type'`, one per definition. The tab shows them as ONE pinned group
 * ("Record types") whose children are `typeGrants`, so the count is summed here
 * rather than in each caller.
 */
export function useMemberShares(memberId: string) {
  const query = api.member.shareSummary.useQuery({ memberId })

  const instanceGroups = useMemo(
    () => (query.data?.groups ?? []).filter((g) => g.kind === 'instance'),
    [query.data]
  )
  const typeGrants = query.data?.typeGrants ?? []
  const owned = query.data?.owned ?? []

  return {
    isLoading: query.isLoading,
    /** Sweepable groups, already ordered by count descending (§3.3). */
    instanceGroups,
    /** Rows of the pinned group. Never swept, individually revocable. */
    typeGrants,
    owned,
    /** Every sweepable row this member holds — the "Select all N" denominator. */
    totalShared: instanceGroups.reduce((sum, g) => sum + g.count, 0),
    /** Owned rows are counts-only; this drives whether the section renders. */
    totalOwned: owned.reduce((sum, o) => sum + o.count, 0),
    /**
     * How deep a search scans one group. A group holding more rows than this is
     * searching only its most recent, and the group row says so — search matches
     * the redacted label rather than running SQL against `Thread.subject`, so
     * the scan is bounded by row count instead of an index.
     */
    searchScanCap: query.data?.searchScanCap ?? 0,
  }
}

/**
 * One group's rows, fetched lazily when the group opens (§3.1).
 *
 * `enabled` is what makes the expand the fetch: a collapsed group costs nothing,
 * and first paint is the single `GROUP BY` behind {@link useMemberShares}.
 *
 * With `q` set the server switches to a bounded label scan and returns no
 * cursor — `total` then means "matches found", which is what lets a truncated
 * group say `showing 10 of 34 matches` honestly (§3.4).
 */
export function useMemberShareGroup(params: {
  memberId: string
  entityDefinitionId: string
  enabled: boolean
  q?: string
}) {
  const { memberId, entityDefinitionId, enabled, q } = params
  const query = api.member.shares.useInfiniteQuery(
    { memberId, entityDefinitionId, q: q || undefined },
    { getNextPageParam: (last) => last.nextCursor, enabled }
  )

  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])

  return {
    items,
    /** Rows in the group (or matches, when searching). */
    total: query.data?.pages[0]?.total ?? 0,
    isLoading: query.isLoading && enabled,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  }
}

/**
 * The bulk revoke, plus the invalidation both sections need afterwards.
 *
 * Returns the raw payload rather than a boolean: `runBatch` reads partial
 * failure off `{ revoked, refused }` instead of counting caught throws, and the
 * summary toast's total is `revoked + Σ refused.count` — never `ids.length`,
 * which on a scope-based sweep is only the loaded page (§6.4b).
 */
export function useRevokeMemberShares(memberId: string) {
  const utils = api.useUtils()
  const revokeShares = api.member.revokeShares.useMutation()

  const invalidate = useCallback(() => {
    utils.member.shareSummary.invalidate({ memberId })
    utils.member.shares.invalidate({ memberId })
  }, [utils, memberId])

  const revoke = useCallback(
    (scope: RevokeSharesScope): Promise<RevokeSharesResult> =>
      revokeShares.mutateAsync({ memberId, scope }),
    [revokeShares, memberId]
  )

  return { revoke, invalidate, isRevoking: revokeShares.isPending }
}

/**
 * `grantedById` → display name, off the member list the detail page already
 * holds. A granter who has since left the org resolves to nothing and the row
 * simply omits the "by …" clause rather than printing a raw id.
 */
export function useGranterNames() {
  const { data } = api.member.all.useQuery()
  return useMemo(() => {
    const byId = new Map<string, string>()
    for (const member of data?.members ?? []) {
      const name = member.user?.name || member.user?.email
      if (name) byId.set(member.userId, name)
    }
    return byId
  }, [data])
}
