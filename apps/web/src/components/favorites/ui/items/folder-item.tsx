// apps/web/src/components/favorites/ui/items/folder-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { Folder } from 'lucide-react'
import { useFavoriteFolder } from '../../hooks/use-favorite-folder'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function FolderItem({ favorite }: { favorite: FavoriteEntity<'FOLDER'> }) {
  const ids = favorite.targetIds
  const { folder, isLoading, isNotFound } = useFavoriteFolder(ids?.folderId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !folder) return <FavoriteItemSkeleton />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<Folder />}
      title={folder.name}
      subtitle='Folder'
      href={`/app/files?folder=${folder.id}`}
    />
  )
}
