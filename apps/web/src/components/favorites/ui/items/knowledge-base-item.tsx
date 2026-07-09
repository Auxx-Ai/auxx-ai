// apps/web/src/components/favorites/ui/items/knowledge-base-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { Book } from 'lucide-react'
import { useFavoriteKnowledgeBase } from '../../hooks/use-favorite-knowledge-base'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function KnowledgeBaseItem({ favorite }: { favorite: FavoriteEntity<'KNOWLEDGE_BASE'> }) {
  const ids = favorite.targetIds
  const { knowledgeBase, isLoading, isNotFound } = useFavoriteKnowledgeBase(ids?.knowledgeBaseId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !knowledgeBase || !ids) return <FavoriteItemSkeleton favoriteId={favorite.id} />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<Book />}
      title={knowledgeBase.name || 'Untitled knowledge base'}
      subtitle='Knowledge base'
      href={`/app/kb/${ids.knowledgeBaseId}/editor?panel=articles`}
    />
  )
}
