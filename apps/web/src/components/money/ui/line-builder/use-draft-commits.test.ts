// apps/web/src/components/money/ui/line-builder/use-draft-commits.test.ts

import { type Line, lineKindFor } from '@auxx/lib/accounting/documents/lines/client'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DraftLine } from './line-rows'
import { DEFAULT_LINE_VALUES } from './line-values'
import type { useLineWrites } from './lines-cache'
import { useDraftCommits } from './use-draft-commits'

vi.mock('@auxx/ui/components/toast', () => ({ toastError: vi.fn() }))

function setup() {
  let resolveCreate: (lines: Line[]) => void = () => {}
  const writes = {
    create: vi.fn(() => new Promise<Line[]>((resolve) => (resolveCreate = resolve))),
    update: vi.fn(),
    updateMany: vi.fn(async () => []),
    reorder: vi.fn(),
    remove: vi.fn(),
  }
  const draftsRef = { current: [{ ...DEFAULT_LINE_VALUES, draftId: 'd1', creating: false }] }
  const mutateDrafts = (fn: (prev: DraftLine[]) => DraftLine[]) => {
    draftsRef.current = fn(draftsRef.current)
  }
  const { result } = renderHook(() =>
    useDraftCommits({
      kind: lineKindFor('quote'),
      visitId: undefined,
      enabled: true,
      writes: writes as unknown as ReturnType<typeof useLineWrites>,
      draftsRef,
      mutateDrafts,
      initialDraftIdsRef: { current: new Set<string>() },
      displayIdsRef: { current: [] },
    })
  )
  const settleCreate = () => act(async () => resolveCreate([{ id: 'line_1' } as Line]))
  return { result, writes, draftsRef, settleCreate }
}

describe('useDraftCommits', () => {
  it('flushes an edit committed while the create is in flight as one updateMany', async () => {
    const { result, writes, draftsRef, settleCreate } = setup()
    let created: Promise<void> = Promise.resolve()
    act(() => {
      created = result.current.createDraft('d1', { name: 'Widget A' })
    })
    await act(() => result.current.createDraft('d1', { qty: 3 }))
    expect(writes.create).toHaveBeenCalledTimes(1)
    await settleCreate()
    await act(() => created)
    expect(writes.updateMany).toHaveBeenCalledWith([{ lineId: 'line_1', patch: { qty: 3 } }])
    expect(draftsRef.current).toEqual([])
  })

  it('keys the created line by its draft id, so its row stays mounted', async () => {
    const { result, settleCreate } = setup()
    let created: Promise<void> = Promise.resolve()
    act(() => {
      created = result.current.createDraft('d1', { name: 'Widget A' })
    })
    expect(result.current.rowKeys.size).toBe(0)
    await settleCreate()
    await act(() => created)
    expect(result.current.rowKeys.get('line_1')).toBe('d1')
  })

  it('sends a commit that reaches the draft after the swap to its line', async () => {
    const { result, writes, settleCreate } = setup()
    let created: Promise<void> = Promise.resolve()
    act(() => {
      created = result.current.createDraft('d1', { name: 'Widget A' })
    })
    await settleCreate()
    await act(() => created)
    // The unmounted draft row's qty input blurs after the swap and commits to the draft id.
    await act(() => result.current.createDraft('d1', { qty: 3, unit: null }))
    expect(writes.create).toHaveBeenCalledTimes(1)
    expect(writes.update).toHaveBeenCalledWith('line_1', { qty: 3, unit: null })
  })
})
