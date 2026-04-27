// apps/web/src/components/favorites/ui/items/dataset-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { Database } from 'lucide-react'
import { useFavoriteDataset } from '../../hooks/use-favorite-dataset'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function DatasetItem({ favorite }: { favorite: FavoriteEntity<'DATASET'> }) {
  const ids = favorite.targetIds
  const { dataset, isLoading, isNotFound } = useFavoriteDataset(ids?.datasetId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !dataset) return <FavoriteItemSkeleton />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<Database />}
      title={dataset.name}
      subtitle='Dataset'
      href={`/app/datasets/${dataset.id}`}
    />
  )
}
