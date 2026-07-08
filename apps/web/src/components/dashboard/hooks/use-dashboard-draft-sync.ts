// apps/web/src/components/dashboard/hooks/use-dashboard-draft-sync.ts
'use client'

// Bridge between `dashboard.get` and the draft store: seeds the published
// snapshot + the server draft on load/re-seed, resets on unmount. The store's
// `seed` keeps the local draft when a refetch lands for the SAME dashboard
// mid-edit, so a background refresh never clobbers uncommitted work. Network
// lives here; the store stays api-free.

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useDashboardStore } from '../stores/dashboard-draft-store'

export function useDashboardDraftSync(dashboardId: string) {
  const query = api.dashboard.get.useQuery({ id: dashboardId })
  const seed = useDashboardStore((s) => s.seed)
  const reset = useDashboardStore((s) => s.reset)

  useEffect(() => {
    if (!query.data) return
    seed(dashboardId, {
      published: query.data.layout,
      draft: query.data.draftLayout,
      versionNumber: query.data.versionNumber,
      hasUnpublishedChanges: query.data.hasUnpublishedChanges,
    })
  }, [query.data, dashboardId, seed])

  useEffect(() => () => reset(), [reset])

  return query
}
