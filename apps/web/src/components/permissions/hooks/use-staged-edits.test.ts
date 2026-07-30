// apps/web/src/components/permissions/hooks/use-staged-edits.test.ts

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  mergeStaged,
  parseStagedInstanceKey,
  type StagedSurface,
  stagedInstanceKey,
  useStagedEdits,
} from './use-staged-edits'

/**
 * The primitive behind every grid on the permissions page. Its contract is small
 * and two parts of it are load-bearing:
 *
 * - staging a row back to the persisted value must DROP the entry, or the Save
 *   bar stays up after an edit is undone by hand and Save writes a no-op;
 * - `mergeStaged` must run its surfaces **sequentially**, because they all write
 *   into the same `ResourceAccess` space and each invalidates on settle.
 */

function surface(overrides: Partial<StagedSurface> = {}): StagedSurface {
  return {
    isDirty: false,
    isSaving: false,
    save: async () => true,
    discard: () => {},
    ...overrides,
  }
}

describe('useStagedEdits', () => {
  it('stages a value that differs from the persisted one', () => {
    const { result } = renderHook(() => useStagedEdits<string>())

    act(() => result.current.stage('a', 'edit', 'view'))

    expect(result.current.isDirty).toBe(true)
    expect(result.current.edits).toEqual({ a: 'edit' })
  })

  it('drops the entry when staged back to the persisted value', () => {
    const { result } = renderHook(() => useStagedEdits<string>())

    act(() => result.current.stage('a', 'edit', 'view'))
    act(() => result.current.stage('a', 'view', 'view'))

    expect(result.current.isDirty).toBe(false)
    expect(result.current.edits).toEqual({})
  })

  /** Nothing staged for this key and nothing to stage — must not churn state. */
  it('is a no-op when the value already matches and nothing was staged', () => {
    const { result } = renderHook(() => useStagedEdits<string>())
    const before = result.current.edits

    act(() => result.current.stage('a', 'view', 'view'))

    expect(result.current.edits).toBe(before)
  })

  it('clears everything on discard', () => {
    const { result } = renderHook(() => useStagedEdits<string>())

    act(() => result.current.stage('a', 'edit', 'view'))
    act(() => result.current.stage('b', 'admin', 'view'))
    act(() => result.current.discard())

    expect(result.current.isDirty).toBe(false)
  })

  /** How a flush keeps the rows whose write failed and forgets the ones that landed. */
  it('keeps only what replace is given', () => {
    const { result } = renderHook(() => useStagedEdits<string>())

    act(() => result.current.stage('a', 'edit', 'view'))
    act(() => result.current.stage('b', 'admin', 'view'))
    act(() => result.current.replace({ b: 'admin' }))

    expect(result.current.edits).toEqual({ b: 'admin' })
  })
})

describe('mergeStaged', () => {
  it('is dirty or saving when any surface is', () => {
    expect(mergeStaged([surface(), surface({ isDirty: true })]).isDirty).toBe(true)
    expect(mergeStaged([surface(), surface({ isSaving: true })]).isSaving).toBe(true)
    expect(mergeStaged([surface(), surface()]).isDirty).toBe(false)
  })

  it('saves sequentially, in the order it was given', async () => {
    const order: string[] = []
    const slow = surface({
      save: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push('first')
        return true
      },
    })
    const fast = surface({
      save: async () => {
        order.push('second')
        return true
      },
    })

    await mergeStaged([slow, fast]).save()

    expect(order).toEqual(['first', 'second'])
  })

  it('reports failure when any surface fails, and still runs the rest', async () => {
    const later = vi.fn(async () => true)
    const merged = mergeStaged([surface({ save: async () => false }), surface({ save: later })])

    expect(await merged.save()).toBe(false)
    expect(later).toHaveBeenCalled()
  })

  it('discards every surface', () => {
    const a = vi.fn()
    const b = vi.fn()

    mergeStaged([surface({ discard: a }), surface({ discard: b })]).discard()

    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
  })
})

describe('instance row keys', () => {
  /** An instance id is only unique within its type, and every type renders at once. */
  it('round-trips a type and an instance id', () => {
    const key = stagedInstanceKey('dataset', 'ds_abc')
    expect(parseStagedInstanceKey(key)).toEqual({ key: 'dataset', instanceId: 'ds_abc' })
  })

  it('splits at the FIRST colon, so an id containing one survives', () => {
    const key = stagedInstanceKey('kb', 'a:b')
    expect(parseStagedInstanceKey(key)).toEqual({ key: 'kb', instanceId: 'a:b' })
  })
})
