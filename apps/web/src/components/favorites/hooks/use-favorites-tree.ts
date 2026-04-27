// apps/web/src/components/favorites/hooks/use-favorites-tree.ts
'use client'

import type { FavoriteEntity } from '@auxx/lib/favorites/client'
import { useMemo } from 'react'
import { useFavoritesStore } from '../store/favorites-store'

export interface FavoritesTreeNode {
  folder: FavoriteEntity | null // null = root container
  items: FavoriteEntity[]
}

export interface FavoritesTree {
  rootItems: FavoriteEntity[]
  folders: { folder: FavoriteEntity; items: FavoriteEntity[] }[]
  /** Flat list of root nodes (folders + items) in sortOrder, the order rendered in the sidebar. */
  rootSequence: FavoriteEntity[]
}

function bySortOrder(a: FavoriteEntity, b: FavoriteEntity): number {
  return a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0
}

/** Selector that turns the flat byId map into the tree shape used by the sidebar. */
export function useFavoritesTree(): FavoritesTree {
  const byId = useFavoritesStore((s) => s.byId)
  return useMemo(() => {
    const all = Object.values(byId)
    const root = all.filter((f) => f.parentFolderId === null).sort(bySortOrder)
    const childByParent: Record<string, FavoriteEntity[]> = {}
    for (const f of all) {
      if (f.parentFolderId) {
        if (!childByParent[f.parentFolderId]) childByParent[f.parentFolderId] = []
        childByParent[f.parentFolderId]!.push(f)
      }
    }
    for (const k of Object.keys(childByParent)) {
      childByParent[k]!.sort(bySortOrder)
    }
    const rootItems = root.filter((f) => f.nodeType === 'ITEM')
    const folders = root
      .filter((f) => f.nodeType === 'FOLDER')
      .map((folder) => ({
        folder,
        items: childByParent[folder.id] ?? [],
      }))
    return { rootItems, folders, rootSequence: root }
  }, [byId])
}
