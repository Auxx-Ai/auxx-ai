// apps/web/src/components/dashboard/hooks/use-dashboard-draft-sync.ts
'use client'

// Bridge between `dashboard.get` and the draft store: seeds `persisted` on load
// and re-seed, resets on unmount. The store's `seed` keeps the draft when a
// refetch lands for the SAME dashboard mid-edit, so a background refresh never
// clobbers uncommitted work. Network lives here; the store stays api-free.

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useDashboardStore } from '../stores/dashboard-draft-store'

export function useDashboardDraftSync(dashboardId: string) {
  const query = api.dashboard.get.useQuery({ id: dashboardId })
  const seed = useDashboardStore((s) => s.seed)
  const reset = useDashboardStore((s) => s.reset)

  useEffect(() => {
    if (query.data) seed(dashboardId, query.data.layout, query.data.versionNumber)
  }, [query.data, dashboardId, seed])

  // Start the next dashboard clean. localStorage drafts are NOT cleared here —
  // navigating away and back can still restore an unsaved session.
  useEffect(() => () => reset(), [reset])

  return query
}
