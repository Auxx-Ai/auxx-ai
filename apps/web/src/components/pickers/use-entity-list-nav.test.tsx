// apps/web/src/components/pickers/use-entity-list-nav.test.tsx
//
// Prev/next over an entity switcher's displayed order. Two things matter beyond
// the index math: navigation goes through the caller's `onSelect` with the WHOLE
// item (agents route by slug while `id` stays the permission key), and a dirty
// surface cannot be left without confirming — including when `J` is held down.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prefetch: vi.fn(),
  /** Options every `confirm()` call was made with. */
  confirmCalls: [] as Array<Record<string, unknown>>,
  /** Resolvers for the pending confirms, in call order. */
  resolvers: [] as Array<(value: boolean) => void>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: h.prefetch }),
}))

vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [
    (options: Record<string, unknown>) => {
      h.confirmCalls.push(options)
      return new Promise<boolean>((resolve) => h.resolvers.push(resolve))
    },
    () => null,
  ],
}))

import type { EntitySwitcherItem } from './entity-switcher-list'
import { useEntityListNav } from './use-entity-list-nav'

const ITEMS: EntitySwitcherItem[] = [
  { id: 'a', label: 'A', href: '/app/agents/alpha' },
  { id: 'b', label: 'B', href: '/app/agents/bravo' },
  { id: 'c', label: 'C', href: '/app/agents/charlie' },
]

/** Resolve the oldest pending confirm. */
async function answer(confirmed: boolean) {
  const resolve = h.resolvers.shift()
  expect(resolve).toBeDefined()
  await act(async () => {
    resolve?.(confirmed)
  })
}

function setup(overrides: Partial<Parameters<typeof useEntityListNav>[0]> = {}) {
  const onSelect = vi.fn()
  const view = renderHook((props: Partial<Parameters<typeof useEntityListNav>[0]>) =>
    useEntityListNav({ ordered: ITEMS, activeId: 'b', onSelect, ...overrides, ...props })
  )
  return { ...view, onSelect }
}

describe('useEntityListNav', () => {
  beforeEach(() => {
    h.prefetch.mockClear()
    h.confirmCalls.length = 0
    h.resolvers.length = 0
  })

  it('walks the given order and hands `onSelect` the whole item', () => {
    const { result, onSelect } = setup()

    expect(result.current.index).toBe(1)
    act(() => result.current.goNext())
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])

    act(() => result.current.goPrev())
    expect(onSelect).toHaveBeenLastCalledWith(ITEMS[0])
  })

  it('does not wrap around at either end', () => {
    const first = setup({ activeId: 'a' })
    expect(first.result.current.hasPrev).toBe(false)
    expect(first.result.current.hasNext).toBe(true)
    act(() => first.result.current.goPrev())
    expect(first.onSelect).not.toHaveBeenCalled()

    const last = setup({ activeId: 'c' })
    expect(last.result.current.hasNext).toBe(false)
    act(() => last.result.current.goNext())
    expect(last.onSelect).not.toHaveBeenCalled()
  })

  it('reports an entity that is not in the list as orphaned', () => {
    const { result, onSelect } = setup({ activeId: 'gone' })

    expect(result.current.index).toBe(-1)
    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(false)
    act(() => result.current.goNext())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('disables both directions while the list is loading', () => {
    const { result, onSelect } = setup({ isLoading: true })

    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(false)
    act(() => result.current.goNext())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('prefetches both neighbours', async () => {
    setup()

    await waitFor(() => {
      expect(h.prefetch).toHaveBeenCalledWith('/app/agents/alpha')
      expect(h.prefetch).toHaveBeenCalledWith('/app/agents/charlie')
    })
  })

  it('costs nothing on a switcher that mounts no arrows', () => {
    const { result, onSelect } = setup({ enabled: false })

    expect(result.current.hasPrev).toBe(false)
    expect(result.current.hasNext).toBe(false)
    expect(h.prefetch).not.toHaveBeenCalled()
    act(() => result.current.goNext())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('navigates without a dialog when the surface is clean', () => {
    const { result, onSelect } = setup({ isDirty: false })

    act(() => result.current.goNext())

    expect(h.confirmCalls).toHaveLength(0)
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])
  })

  it('holds the navigation until a dirty surface confirms', async () => {
    const { result, onSelect } = setup({ isDirty: true })

    act(() => result.current.goNext())
    expect(onSelect).not.toHaveBeenCalled()
    expect(h.confirmCalls).toHaveLength(1)

    await answer(true)
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2])
  })

  it('stays put when the user keeps editing', async () => {
    const { result, onSelect } = setup({ isDirty: true })

    act(() => result.current.goNext())
    await answer(false)

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens one dialog for a held-down key, and honours the LAST direction', async () => {
    const { result, onSelect } = setup({ isDirty: true })

    act(() => result.current.goNext())
    act(() => result.current.goNext())
    act(() => result.current.goPrev())

    expect(h.confirmCalls).toHaveLength(1)

    await answer(true)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0])
  })

  it('guards any other navigation the switcher owns, e.g. a row click', async () => {
    const { result, onSelect } = setup({ isDirty: true })
    const rowClick = vi.fn()

    act(() => result.current.guard(rowClick))
    expect(rowClick).not.toHaveBeenCalled()

    await answer(true)
    expect(rowClick).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('lets a surface override the confirm copy', () => {
    const { result } = setup({
      isDirty: true,
      confirmOptions: { description: 'This workflow has unsaved changes.' },
    })

    act(() => result.current.goNext())

    expect(h.confirmCalls[0]).toMatchObject({
      title: 'Discard changes?',
      description: 'This workflow has unsaved changes.',
      confirmText: 'Discard and leave',
    })
  })
})
