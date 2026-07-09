// apps/web/src/components/favorites/ui/items/dashboard-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { LayoutDashboard } from 'lucide-react'
import { useFavoriteDashboard } from '../../hooks/use-favorite-dashboard'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function DashboardItem({ favorite }: { favorite: FavoriteEntity<'DASHBOARD'> }) {
  const ids = favorite.targetIds
  const { dashboard, isLoading, isNotFound } = useFavoriteDashboard(ids?.dashboardId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !dashboard || !ids) return <FavoriteItemSkeleton />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<LayoutDashboard />}
      title={dashboard.name || 'Untitled dashboard'}
      subtitle='Dashboard'
      href={`/app/dashboards/${ids.dashboardId}`}
    />
  )
}
