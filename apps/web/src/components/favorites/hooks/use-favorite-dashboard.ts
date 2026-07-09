// apps/web/src/components/favorites/hooks/use-favorite-dashboard.ts
'use client'

import { useMemo } from 'react'
import { api } from '~/trpc/react'

const STALE_TIME = 5 * 60 * 1000

export function useFavoriteDashboard(dashboardId: string | null | undefined) {
  const { data, isLoading, error } = api.dashboard.list.useQuery(undefined, {
    enabled: !!dashboardId,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  })

  const dashboard = useMemo(
    () => (data ? data.find((d) => d.id === dashboardId) : undefined),
    [data, dashboardId]
  )

  const code = error?.data?.code
  const isNotFound =
    code === 'NOT_FOUND' || code === 'FORBIDDEN' || (!isLoading && !!data && !dashboard)

  return { dashboard, isLoading, isNotFound }
}
