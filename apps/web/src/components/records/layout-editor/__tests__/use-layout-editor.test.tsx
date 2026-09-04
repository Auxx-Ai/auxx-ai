// apps/web/src/components/records/layout-editor/__tests__/use-layout-editor.test.tsx
//
// The session half of §9.6: edits stage locally and commit on Save, so Cancel
// and Esc discard the whole session and the caller sees one consistent write.
//
// The seed rule is what this file exists to pin. It fires on the closed → open
// transition ONLY: re-seeding whenever a prop identity changed would throw away
// edits the admin has staged but not saved, and `registry` is a fresh object on
// every render of the caller, so that mistake is one line away at all times.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  org: null as unknown,
  user: null as unknown,
  isLoading: false,
}))

vi.mock('~/providers/capabilities-provider', () => ({ useAccess: () => ({ can: () => true }) }))
vi.mock('~/providers/feature-flag-provider', () => ({
  useFeatureFlags: () => ({ hasAccess: () => true }),
}))
vi.mock('~/components/resources', () => ({ useCanViewRecordResource: () => () => true }))
vi.mock('~/trpc/react', () => ({
  api: {
    recordLayout: {
      get: {
        useQuery: () => ({ data: { org: h.org, user: h.user }, isLoading: h.isLoading }),
      },
    },
  },
}))

import { moveBlock, setTabHidden } from '../editor-actions'
import { testRegistry } from '../test-fixtures'
import { useLayoutEditor } from '../use-layout-editor'

/**
 * The hook builds the registry layer from the LIVE `contact` drawer registry,
 * not from the `layout` prop: that is the point of it, and it is why these ids
 * are real ones rather than the fixture's.
 */
const MOVED_BLOCK = 'card:interactions'

const params = {
  entityDefinitionId: 'edf_contact00000000000000000',
  entityType: 'contact',
  surface: 'drawer' as const,
  layout: testRegistry(),
}

beforeEach(() => {
  h.org = null
  h.user = null
  h.isLoading = false
})

describe('useLayoutEditor', () => {
  it('starts clean and reports no write to make', () => {
    const { result } = renderHook(() => useLayoutEditor({ open: true, ...params }))

    expect(result.current.orgDirty).toBe(false)
    expect(result.current.personalDirty).toBe(false)
    expect(result.current.deltas).toEqual({ org: {}, user: {} })
  })

  it('keeps a staged edit across re-renders with fresh prop identities', () => {
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useLayoutEditor({ ...props, ...params, layout: testRegistry() }),
      { initialProps: { open: true } }
    )

    act(() => {
      result.current.update((state) =>
        moveBlock(state, { blockId: MOVED_BLOCK, overId: 'group:billing' })
      )
    })
    expect(result.current.orgDirty).toBe(true)

    // A new `layout` object every render, which is what the drawer actually
    // hands this hook. Re-seeding here would silently discard the move.
    rerender({ open: true })
    rerender({ open: true })

    expect(result.current.state.tabOfBlock[MOVED_BLOCK]).toBe('billing')
    expect(result.current.deltas.org.blocks).toEqual({ [MOVED_BLOCK]: { tab: 'billing' } })
  })

  it('discards the whole session when the dialog closes without saving', () => {
    const { result, rerender } = renderHook(
      (props: { open: boolean }) => useLayoutEditor({ ...props, ...params }),
      { initialProps: { open: true } }
    )

    act(() => {
      result.current.update((state) => setTabHidden(state, 'billing', true))
    })
    expect(result.current.personalDirty).toBe(true)

    // Cancel: nothing was written, so the next open re-seeds from the server's
    // still-empty deltas and the staged hide is gone.
    rerender({ open: false })
    rerender({ open: true })

    expect(result.current.state.hiddenTabs).toEqual([])
    expect(result.current.personalDirty).toBe(false)
    expect(result.current.deltas).toEqual({ org: {}, user: {} })
  })

  it('seeds from the stored deltas once they land, not from an empty layout', () => {
    h.isLoading = true
    const { result, rerender } = renderHook(
      (props: { open: boolean }) => useLayoutEditor({ ...props, ...params }),
      { initialProps: { open: true } }
    )

    h.isLoading = false
    h.org = { blocks: { [MOVED_BLOCK]: { tab: 'billing' } } }
    rerender({ open: true })

    expect(result.current.state.tabOfBlock[MOVED_BLOCK]).toBe('billing')
    // Seeded state is the baseline, so an untouched session writes nothing even
    // though the stored delta is non-empty.
    expect(result.current.orgDirty).toBe(false)
  })

  it('routes the two scopes to two independent dirty flags', () => {
    const { result } = renderHook(() => useLayoutEditor({ open: true, ...params }))

    act(() => {
      result.current.update((state) => setTabHidden(state, 'billing', true))
    })
    expect(result.current.personalDirty).toBe(true)
    expect(result.current.orgDirty).toBe(false)

    act(() => {
      result.current.update((state) =>
        moveBlock(state, { blockId: MOVED_BLOCK, overId: 'group:tasks' })
      )
    })
    // Refused: `tasks` is a base tab, so the org layer is still clean.
    expect(result.current.orgDirty).toBe(false)

    act(() => {
      result.current.update((state) =>
        moveBlock(state, { blockId: MOVED_BLOCK, overId: 'group:billing' })
      )
    })
    expect(result.current.orgDirty).toBe(true)
  })
})
