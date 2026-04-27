// apps/web/src/components/favorites/ui/items/snippet-item.tsx
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { NotepadText } from 'lucide-react'
import { useFavoriteSnippet } from '../../hooks/use-favorite-snippet'
import { FavoriteItemRow } from '../favorite-item-row'
import { FavoriteItemSkeleton } from '../favorite-item-skeleton'
import { PrivateItem } from '../private-item'

export function SnippetItem({ favorite }: { favorite: FavoriteEntity<'SNIPPET'> }) {
  const ids = favorite.targetIds
  const { snippet, isLoading, isNotFound } = useFavoriteSnippet(ids?.snippetId)

  if (isNotFound) return <PrivateItem favoriteId={favorite.id} />
  if (isLoading || !snippet) return <FavoriteItemSkeleton />

  return (
    <FavoriteItemRow
      favoriteId={favorite.id}
      icon={<NotepadText />}
      title={snippet.title}
      subtitle='Snippet'
      href={`/app/settings/snippets?selected=${snippet.id}`}
    />
  )
}
