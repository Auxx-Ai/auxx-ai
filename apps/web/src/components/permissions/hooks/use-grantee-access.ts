// apps/web/src/components/permissions/hooks/use-grantee-access.ts
'use client'

import { api } from '~/trpc/react'
import type { GranteeKind } from './use-grantee-def-access'

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
    invalidate: query.refetch,
  }
}
