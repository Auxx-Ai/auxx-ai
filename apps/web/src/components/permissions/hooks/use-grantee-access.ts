// apps/web/src/components/permissions/hooks/use-grantee-access.ts
'use client'

import { useCallback } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import type { GranteeKind } from './use-grantee-def-access'

/** The whole `granteeAccess` payload, as the query cache holds it. */
export type GranteeAccessData = RouterOutputs['permissions']['granteeAccess']

/**
 * Invalidate every `granteeAccess` query — call after ANY permission write.
 *
 * **The whole keyspace, deliberately, not `{granteeType, granteeId}`.** `own` is
 * per-grantee, but `effective` is COMPOSED, so a write aimed at one grantee moves
 * another's answer: a group grant changes every member of that group, a profile
 * save changes every holder, and a `role:org_member` workspace default changes
 * everyone. Scoping the invalidation to the grantee that was written is the
 * obvious-looking version and is wrong in exactly the cases the effective line
 * exists to expose.
 *
 * Cheap regardless: only mounted queries refetch, and a grantee page has one.
 *
 * The server half is already correct and needs nothing — `setGranteeLevels` and
 * the `resource-access.*` emitters both `await onCacheEvent(...)` after commit,
 * so the composed `user:capabilities` blob is busted before the mutation returns
 * and a refetch here is guaranteed to compose fresh. What was missing was purely
 * this client-side refetch: `permissions.grant`/`revoke` update `listGrants`
 * optimistically and deliberately never refetch on success, so nothing told
 * `granteeAccess` its answer had changed and the effective line kept showing the
 * pre-write composition for up to its 30s `staleTime`.
 *
 * The `permission-grant.changed` realtime nudge does not cover this either: it
 * targets the AFFECTED member's own client so their `myCapabilities` refreshes,
 * not the admin's client sitting on that member's Permissions tab.
 *
 * Returns the invalidation promise so a staged flush can await the refetch before
 * clearing its edits (`useStagedEdits`) — otherwise every select would flash back
 * to its pre-save value for the length of the round-trip. `onSettled` callers
 * ignore it, which is why it is `void`-ed at those call sites rather than here.
 */
export function useInvalidateGranteeAccess() {
  const utils = api.useUtils()
  return useCallback(() => utils.permissions.granteeAccess.invalidate(), [utils])
}

/**
 * Optimistically patch one grantee's cached payload, so a select moves the
 * instant it is clicked instead of after a round-trip.
 *
 * **Patch `own` and `baseline` only. Never `effective`.** That is not a style
 * rule, it is the line the last bug in this file was on: `own` and `baseline`
 * are rows the server stores verbatim, so the client can predict them exactly;
 * `effective` is COMPOSED — `max` across the grantee's profile, every group they
 * are in and their own row, then clamped by the profile and seat ceilings — and
 * predicting it here would mean a second implementation of composition running
 * against the enforcement path. Leave it stale and let
 * {@link useInvalidateGranteeAccess} refetch it; a briefly-behind effective line
 * is honest, a confidently-wrong one is not.
 *
 * A no-op when the query is not mounted, which is what makes it safe to fire
 * from the shared write path regardless of which surface is on screen.
 */
export function usePatchGranteeAccess() {
  const utils = api.useUtils()
  return useCallback(
    (
      granteeType: GranteeKind,
      granteeId: string,
      patch: (prev: GranteeAccessData) => GranteeAccessData
    ) => {
      utils.permissions.granteeAccess.setData({ granteeType, granteeId }, (prev) =>
        prev ? patch(prev) : prev
      )
    },
    [utils]
  )
}

/**
 * One grantee's access, for one grantee (plan 31 §2.4) — the grantee-scoped
 * replacement for the three org-wide reads the detail pages used to run and
 * filter client-side (`permissions.listGrants`, `resourceAccess.allTypeAccess`,
 * `resourceAccess.allInstanceAccess`).
 *
 * Returns two halves because every row shows both: `own` drives the
 * `AccessLevelSelect` (this grantee's explicit row), `effective` drives the line
 * under the name (what they can actually open). `effective` is `null` for
 * `group`/`profile` — they are level sources, not subjects.
 *
 * The org-wide endpoints deliberately SURVIVE: the overrides tab's grantee LIST
 * needs `listGrants` to know who has an override at all, and the Workspace
 * defaults tab is org-wide by definition. Only the grantee DETAIL moved.
 */
export function useGranteeAccess(granteeType: GranteeKind, granteeId: string) {
  const query = api.permissions.granteeAccess.useQuery(
    { granteeType, granteeId },
    { staleTime: 30_000, enabled: granteeId.length > 0 }
  )

  return {
    isLoading: query.isLoading,
    own: query.data?.own,
    baseline: query.data?.baseline,
    effective: query.data?.effective ?? null,
  }
}
