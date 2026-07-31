// apps/web/src/components/pickers/use-entity-switcher-order.ts
'use client'

import type { FavoriteTargetIdsMap, FavoriteTargetType } from '@auxx/lib/favorites/client'
import { favoriteTargetKey } from '@auxx/lib/favorites/client'
import type * as React from 'react'
import { useMemo } from 'react'
import { useFavoritesStore } from '~/components/favorites/store/favorites-store'
import type { EntitySwitcherItem } from './entity-switcher-list'

/** Group id used by the default Favorites/All partition. */
export const FAVORITES_GROUP_ID = '__favorites__'
/** Group id used by the default Favorites/All partition. */
export const ALL_GROUP_ID = '__all__'

/**
 * Favoritable-entity config shared by {@link useEntitySwitcherOrder} and
 * `EntitySwitcherList`. Omit entirely for non-favoritable types.
 */
export interface EntitySwitcherFavoriteConfig<T extends FavoriteTargetType = FavoriteTargetType> {
  targetType: T
  targetIds: (item: EntitySwitcherItem) => FavoriteTargetIdsMap[T]
}

/** One headed section of a switcher list, in display order. */
export interface EntitySwitcherSection {
  id: string
  heading: React.ReactNode
  items: EntitySwitcherItem[]
}

export interface EntitySwitcherOrder {
  /** Headed sections in display order, or `null` when the list is ungrouped. */
  sections: EntitySwitcherSection[] | null
  /** The flattened display order — the sequence prev/next walks. */
  ordered: EntitySwitcherItem[]
  /** Whether a given item is favorited. Reused by the list's row renderer. */
  isFavorited: (item: EntitySwitcherItem) => boolean
}

export interface UseEntitySwitcherOrderInput<T extends FavoriteTargetType = FavoriteTargetType> {
  items: EntitySwitcherItem[]
  groupBy?: (item: EntitySwitcherItem) => string
  groups?: Array<{ id: string; heading?: React.ReactNode }>
  favorite?: EntitySwitcherFavoriteConfig<T>
}

/**
 * The single source of truth for the order a switcher list is displayed in.
 *
 * A switcher's `items` array is **not** what the user sees: favoritable lists are
 * partitioned into Favorites/All, and callers may supply their own `groupBy`. Both
 * the rendered list and the prev/next nav read the order from here, so "the row
 * below this one" means the same thing to the eye and to the `J` key.
 *
 * Grouping runs over the **unfiltered** items — the search box is transient
 * popover state and must not redefine what "next" means. `EntitySwitcherList`
 * applies its own search filter to each section and drops the emptied ones.
 */
export function useEntitySwitcherOrder<T extends FavoriteTargetType = FavoriteTargetType>({
  items,
  groupBy,
  groups,
  favorite,
}: UseEntitySwitcherOrderInput<T>): EntitySwitcherOrder {
  const favoritesById = useFavoritesStore((s) => s.byId)

  // Every favorited target key the store holds. One pass, reused by every row —
  // `useFavoriteForTarget` is a hook and can't be called per item.
  const favoritedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const fav of Object.values(favoritesById)) {
      if (fav.nodeType !== 'ITEM' || !fav.targetType || !fav.targetIds) continue
      keys.add(
        favoriteTargetKey(fav.targetType, fav.targetIds as FavoriteTargetIdsMap[FavoriteTargetType])
      )
    }
    return keys
  }, [favoritesById])

  const isFavorited = useMemo(
    () => (item: EntitySwitcherItem) =>
      favorite
        ? favoritedKeys.has(favoriteTargetKey(favorite.targetType, favorite.targetIds(item)))
        : false,
    [favorite, favoritedKeys]
  )

  // Favorites/All is the default partition for favoritable entities — a handful
  // of pinned rows stay on top no matter how long the list gets. Costs no query:
  // the favorites store is already hydrated client-side.
  const effectiveGroupBy = useMemo(() => {
    if (groupBy) return groupBy
    if (!favorite) return undefined
    return (item: EntitySwitcherItem) => (isFavorited(item) ? FAVORITES_GROUP_ID : ALL_GROUP_ID)
  }, [groupBy, favorite, isFavorited])

  const effectiveGroups = useMemo(() => {
    if (groupBy) return groups
    if (!favorite) return undefined
    return [
      { id: FAVORITES_GROUP_ID, heading: 'Favorites' },
      { id: ALL_GROUP_ID, heading: 'All' },
    ]
  }, [groupBy, groups, favorite])

  // Ordered, headed sections; `null` keeps the single ungrouped list. Group order
  // follows `groups`, then any ids `groupBy` produces that `groups` omits
  // (first-seen).
  const sections = useMemo(() => {
    if (!effectiveGroupBy) return null
    const headingById = new Map((effectiveGroups ?? []).map((g) => [g.id, g.heading]))
    const order: string[] = (effectiveGroups ?? []).map((g) => g.id)
    const itemsById = new Map<string, EntitySwitcherItem[]>()
    for (const item of items) {
      const id = effectiveGroupBy(item)
      if (!itemsById.has(id)) {
        itemsById.set(id, [])
        if (!headingById.has(id)) order.push(id)
      }
      itemsById.get(id)?.push(item)
    }
    return order
      .filter((id) => itemsById.has(id))
      .map((id) => ({ id, heading: headingById.get(id) ?? id, items: itemsById.get(id) ?? [] }))
  }, [effectiveGroupBy, effectiveGroups, items])

  const ordered = useMemo(
    () => (sections ? sections.flatMap((section) => section.items) : items),
    [sections, items]
  )

  return { sections, ordered, isFavorited }
}
