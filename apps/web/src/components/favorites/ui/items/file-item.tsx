// apps/web/src/components/favorites/ui/items/file-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { File as FileIcon } from 'lucide-react'
import { useFavoriteFile } from '../../hooks/use-favorite-file'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function FileItem({ favorite }: { favorite: FavoriteEntity<'FILE'> }) {
  const ids = favorite.targetIds
  const { file, isLoading, isNotFound } = useFavoriteFile(ids?.folderFileId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !file) return <FavoriteItemSkeleton />

  // Use the file's live parentId so the link still works if the file moved
  // since being favorited. Falls back to the stored folderId.
  const folderId = file.parentId ?? ids?.folderId ?? null
  const params = new URLSearchParams()
  if (folderId) params.set('folder', folderId)
  params.set('id', file.id)
  const href = `/app/files?${params.toString()}`

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<FileIcon />}
      title={file.name ?? 'Untitled file'}
      subtitle='File'
      href={href}
    />
  )
}
