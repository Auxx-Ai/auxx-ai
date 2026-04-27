// apps/web/src/components/favorites/ui/favorites-tree.tsx
'use client'

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useFavoritesTree } from '../hooks/use-favorites-tree'
import { FavoriteFolder } from './favorite-folder'
import { SortableFavoriteRow } from './sortable-favorite-row'

export function FavoritesTree() {
  const tree = useFavoritesTree()

  if (tree.rootSequence.length === 0) return null

  const rootIds = tree.rootSequence.map((n) => `favorite-row-${n.id}`)

  return (
    <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
      {tree.rootSequence.map((node, idx) => {
        if (node.nodeType === 'FOLDER') {
          const items = tree.folders.find((f) => f.folder.id === node.id)?.items ?? []
          return <FavoriteFolder key={node.id} folder={node} items={items} index={idx} />
        }
        return (
          <SortableFavoriteRow key={node.id} favorite={node} parentFolderId={null} index={idx} />
        )
      })}
    </SortableContext>
  )
}
