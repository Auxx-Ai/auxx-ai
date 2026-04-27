// apps/web/src/components/favorites/ui/items/document-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { FileText } from 'lucide-react'
import { useFavoriteDocument } from '../../hooks/use-favorite-document'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function DocumentItem({ favorite }: { favorite: FavoriteEntity<'DOCUMENT'> }) {
  const ids = favorite.targetIds
  const { document, isLoading, isNotFound } = useFavoriteDocument(ids?.documentId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !document) return <FavoriteItemSkeleton />

  const datasetId = ids?.datasetId
  const href = datasetId
    ? `/app/datasets/${datasetId}?id=${document.id}`
    : `/app/datasets/${document.datasetId}?id=${document.id}`

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<FileText />}
      title={document.name ?? 'Untitled document'}
      subtitle='Document'
      href={href}
    />
  )
}
