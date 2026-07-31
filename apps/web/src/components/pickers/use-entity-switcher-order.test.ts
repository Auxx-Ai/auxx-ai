// apps/web/src/components/pickers/use-entity-switcher-order.test.ts
//
// This hook decides what "the row below this one" means. It is consumed twice —
// once by the rendered list, once by the prev/next nav — so the invariant pinned
// here is that `ordered` is exactly the flattened `sections`. If those two ever
// drift, `J` walks to a row the user is not looking at.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useFavoritesStore } from '~/components/favorites/store/favorites-store'
import type { EntitySwitcherItem } from './entity-switcher-list'
import { useEntitySwitcherOrder } from './use-entity-switcher-order'

const item = (id: string): EntitySwitcherItem => ({ id, label: id.toUpperCase() })

const ITEMS = [item('a'), item('b'), item('c'), item('d')]

/** Seed the favorites store with ITEM favorites for the given dashboard ids. */
function favorite(...dashboardIds: string[]) {
  const byId: Record<string, unknown> = {}
  for (const id of dashboardIds) {
    byId[`fav_${id}`] = {
      id: `fav_${id}`,
      nodeType: 'ITEM',
      targetType: 'DASHBOARD',
      targetIds: { dashboardId: id },
    }
  }
  useFavoritesStore.setState({ byId: byId as never })
}

const DASHBOARD_FAVORITE = {
  targetType: 'DASHBOARD' as const,
  targetIds: (i: EntitySwitcherItem) => ({ dashboardId: i.id }),
}

describe('useEntitySwitcherOrder', () => {
  beforeEach(() => {
    useFavoritesStore.setState({ byId: {} })
  })

  it('leaves an ungrouped list in `items` order', () => {
    const { result } = renderHook(() => useEntitySwitcherOrder({ items: ITEMS }))

    expect(result.current.sections).toBeNull()
    expect(result.current.ordered.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('puts favorites first, and `ordered` matches the flattened sections', () => {
    favorite('c')

    const { result } = renderHook(() =>
      useEntitySwitcherOrder({ items: ITEMS, favorite: DASHBOARD_FAVORITE })
    )

    expect(result.current.sections?.map((s) => s.heading)).toEqual(['Favorites', 'All'])
    // The favorited row is hoisted out of its `items` position...
    expect(result.current.ordered.map((i) => i.id)).toEqual(['c', 'a', 'b', 'd'])
    // ...and the nav sequence is exactly what the list renders.
    expect(result.current.ordered).toEqual(result.current.sections?.flatMap((s) => s.items))
  })

  it('drops an empty Favorites section rather than rendering a headed void', () => {
    const { result } = renderHook(() =>
      useEntitySwitcherOrder({ items: ITEMS, favorite: DASHBOARD_FAVORITE })
    )

    expect(result.current.sections?.map((s) => s.id)).toEqual(['__all__'])
    expect(result.current.ordered.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reports favorited membership for the list to render its star', () => {
    favorite('b')

    const { result } = renderHook(() =>
      useEntitySwitcherOrder({ items: ITEMS, favorite: DASHBOARD_FAVORITE })
    )

    expect(result.current.isFavorited(item('b'))).toBe(true)
    expect(result.current.isFavorited(item('a'))).toBe(false)
  })

  it('honours a custom groupBy and its declared group order', () => {
    const { result } = renderHook(() =>
      useEntitySwitcherOrder({
        items: ITEMS,
        groupBy: (i) => (i.id === 'a' || i.id === 'd' ? 'second' : 'first'),
        groups: [
          { id: 'first', heading: 'First' },
          { id: 'second', heading: 'Second' },
        ],
      })
    )

    expect(result.current.ordered.map((i) => i.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('appends groups the caller did not declare, in first-seen order', () => {
    const { result } = renderHook(() =>
      useEntitySwitcherOrder({
        items: ITEMS,
        groupBy: (i) => (i.id === 'a' ? 'known' : i.id),
        groups: [{ id: 'known', heading: 'Known' }],
      })
    )

    expect(result.current.sections?.map((s) => s.id)).toEqual(['known', 'b', 'c', 'd'])
    // Undeclared groups fall back to the raw id as their heading.
    expect(result.current.sections?.[1]?.heading).toBe('b')
  })

  it('ignores a custom groupBy nothing declares alongside favorites', () => {
    favorite('c')

    const { result } = renderHook(() =>
      useEntitySwitcherOrder({
        items: ITEMS,
        favorite: DASHBOARD_FAVORITE,
        groupBy: () => 'one',
      })
    )

    // An explicit groupBy wins over the Favorites/All default.
    expect(result.current.sections?.map((s) => s.id)).toEqual(['one'])
    expect(result.current.ordered.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})
