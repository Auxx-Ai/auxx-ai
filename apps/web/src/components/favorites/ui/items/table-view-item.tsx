// apps/web/src/components/favorites/ui/items/table-view-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { TableProperties } from 'lucide-react'
import { api } from '~/trpc/react'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

const STALE_TIME = 5 * 60 * 1000

export function TableViewItem({ favorite }: { favorite: FavoriteEntity<'TABLE_VIEW'> }) {
  const ids = favorite.targetIds
  const tableViewId = ids?.tableViewId
  const { data, isLoading, error } = api.tableView.get.useQuery(
    { id: tableViewId! },
    { enabled: !!tableViewId, staleTime: STALE_TIME, refetchOnWindowFocus: false }
  )
  const code = error?.data?.code
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN') {
    return <PrivateItem favoriteId={favorite.id} />
  }
  if (isLoading || !data) return <FavoriteItemSkeleton />

  // Most table views live under /app/<apiSlug>?view=<id>; we don't have apiSlug
  // here, so we route through tableId which is a system table or entityDefinitionId.
  const href = `/app/tables/${ids?.tableId}?view=${data.id}`

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<TableProperties />}
      title={data.name}
      subtitle='View'
      href={href}
    />
  )
}
