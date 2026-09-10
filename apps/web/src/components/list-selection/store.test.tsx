// apps/web/src/components/list-selection/store.test.tsx
//
// `setItemIds` and its pruning, which nothing asserted before.
//
// 🛑 This store is shared. Ten lists call `setItemIds` - workflows, connectors,
// knowledge bases, datasets, agents, groups, dashboards, opening stock, the
// chart of accounts - and exactly ONE of them
// (`accounting/ui/settings/chart-list.tsx:175`) passes
// `pruneSelection: false`. So the default and the opt-out are two different
// contracts held by two different sets of callers, and until this file neither
// was covered: flipping the default would have left every suite green while
// silently destroying the pick-a-few-per-search flow on nine screens, or
// destroying the delete-clears-the-selection behaviour on the tenth.
//
// Driven through the real provider rather than the unexported store factory,
// the way `use-bulk-runner.test.tsx` does - the hooks ARE the surface every
// caller uses, and a test that reached past them could pass over a broken one.

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ListSelectionProvider, useListSelection } from './store'

function wrapper({ children }: { children: ReactNode }) {
  return <ListSelectionProvider>{children}</ListSelectionProvider>
}

/** The whole store, so a test can arrange with one action and assert on another. */
function useSubject() {
  return useListSelection((s) => s)
}

/** Put `ids` on screen and select `selected` from them. */
function arrange(
  result: { current: ReturnType<typeof useSubject> },
  ids: string[],
  selected: string[]
) {
  act(() => result.current.setItemIds(ids))
  act(() => {
    for (const id of selected) result.current.toggle(id)
  })
}

describe('setItemIds', () => {
  it('prunes a selected id that is no longer on screen', () => {
    const { result } = renderHook(useSubject, { wrapper })
    arrange(result, ['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(result.current.selectedIds).toEqual(['a', 'b', 'c'])

    // `b` was deleted: it is gone, not hidden, so forgetting it was selected is
    // the correct answer.
    act(() => result.current.setItemIds(['a', 'c']))

    expect(result.current.selectedIds).toEqual(['a', 'c'])
    expect(result.current.itemIds).toEqual(['a', 'c'])
  })

  it('keeps a hidden id selected when the caller opts out', () => {
    const { result } = renderHook(useSubject, { wrapper })
    arrange(result, ['a', 'b', 'c'], ['a', 'b'])

    // The chart list's case: a search narrowed the visible set. `a` and `b` are
    // hidden, not gone, and pruning here is what destroys picking three rows,
    // searching again, and picking two more.
    act(() => result.current.setItemIds(['c'], { pruneSelection: false }))

    expect(result.current.selectedIds).toEqual(['a', 'b'])
    expect(result.current.itemIds).toEqual(['c'])
  })

  it('prunes pending ids even when the selection is spared', () => {
    const { result } = renderHook(useSubject, { wrapper })
    arrange(result, ['a', 'b'], ['a', 'b'])
    act(() => result.current.addPending('a'))
    act(() => result.current.addPending('b'))

    act(() => result.current.setItemIds(['b'], { pruneSelection: false }))

    // 🛑 `pruneSelection` governs the SELECTION only. A pending marker is an
    // overlay on a row that is on screen, so a row that left has no overlay to
    // keep - and the opt-out must not be read as "keep everything".
    expect(result.current.pendingIds).toEqual(['b'])
    expect(result.current.selectedIds).toEqual(['a', 'b'])
  })

  it('never prunes on an empty list', () => {
    const { result } = renderHook(useSubject, { wrapper })
    arrange(result, ['a', 'b'], ['a', 'b'])
    act(() => result.current.addPending('a'))

    // A list that is loading reports no rows. Pruning against it would clear a
    // selection the reader is about to see again.
    act(() => result.current.setItemIds([]))

    expect(result.current.selectedIds).toEqual(['a', 'b'])
    expect(result.current.pendingIds).toEqual(['a'])
    expect(result.current.itemIds).toEqual([])
  })

  it('leaves a selection alone when every id is still on screen', () => {
    const { result } = renderHook(useSubject, { wrapper })
    arrange(result, ['a', 'b', 'c'], ['b'])

    // A reorder, not a removal.
    act(() => result.current.setItemIds(['c', 'b', 'a']))

    expect(result.current.selectedIds).toEqual(['b'])
    expect(result.current.itemIds).toEqual(['c', 'b', 'a'])
  })
})
