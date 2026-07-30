// apps/web/src/components/resources/store/file-ref-store.test.ts
// FILE cells/displays share one hydration store instead of each firing its own
// `file.resolveFileRefs` — these pin the drain contract the provider relies on.

import { beforeEach, describe, expect, it } from 'vitest'
import { getFileRefStoreState, invalidateFileRefs, useFileRefStore } from './file-ref-store'

const REF_A = 'file:cmfilea1234567890'
const REF_B = 'asset:cmassetb123456789'

const detail = (ref: string, name: string) => ({ ref, name, mimeType: 'image/png', size: 1024 })

beforeEach(() => {
  getFileRefStoreState().reset()
})

describe('fileRefStore.requestHydration', () => {
  it('collapses duplicate refs from separate cells into one pending slot', () => {
    // Two rows referencing the same attachment — the whole point of the store.
    getFileRefStoreState().requestHydration([REF_A, REF_B])
    getFileRefStoreState().requestHydration([REF_A])

    expect(useFileRefStore.getState().pendingIds.size).toBe(2)
    expect(getFileRefStoreState().startBatch(100).sort()).toEqual([REF_B, REF_A].sort())
  })

  it('drops malformed refs instead of burning a roundtrip on them', () => {
    // `resolveFileRefs` skips anything without a `<type>:<id>` shape, so a
    // queued bare id could only ever come back as the not-found sentinel.
    getFileRefStoreState().requestHydration(['not-a-ref', REF_A])

    expect(getFileRefStoreState().startBatch(100)).toEqual([REF_A])
  })

  it('does not re-queue refs already hydrated or in flight', () => {
    getFileRefStoreState().requestHydration([REF_A, REF_B])
    getFileRefStoreState().startBatch(100)
    // Both are loading now — a newly mounted cell must not queue them again.
    getFileRefStoreState().requestHydration([REF_A, REF_B])
    expect(useFileRefStore.getState().pendingIds.size).toBe(0)

    getFileRefStoreState().completeBatch(
      [detail(REF_A, 'a.png'), detail(REF_B, 'b.png')],
      [REF_A, REF_B]
    )
    getFileRefStoreState().requestHydration([REF_A, REF_B])
    expect(useFileRefStore.getState().pendingIds.size).toBe(0)
  })
})

describe('fileRefStore.startBatch', () => {
  it('caps the batch and leaves the remainder pending for the next drain', () => {
    const refs = Array.from({ length: 5 }, (_, i) => `file:cmfile${i}`)
    getFileRefStoreState().requestHydration(refs)

    expect(getFileRefStoreState().startBatch(3)).toHaveLength(3)
    expect(useFileRefStore.getState().pendingIds.size).toBe(2)
    expect(getFileRefStoreState().startBatch(3)).toHaveLength(2)
    expect(getFileRefStoreState().startBatch(3)).toEqual([])
  })
})

describe('fileRefStore.completeBatch', () => {
  it('records a null sentinel for refs the server dropped', () => {
    // A deleted file resolves to nothing. Without the sentinel the ref would
    // sit unresolved forever and every remount would re-request it.
    getFileRefStoreState().requestHydration([REF_A, REF_B])
    getFileRefStoreState().startBatch(100)
    getFileRefStoreState().completeBatch([detail(REF_A, 'a.png')], [REF_A, REF_B])

    const { dataMap, loadingIds } = useFileRefStore.getState()
    expect(dataMap[REF_A]?.name).toBe('a.png')
    expect(dataMap[REF_B]).toBeNull()
    expect(loadingIds.size).toBe(0)

    getFileRefStoreState().requestHydration([REF_B])
    expect(useFileRefStore.getState().pendingIds.size).toBe(0)
  })
})

describe('invalidateFileRefs', () => {
  it('lets a renamed file resolve again', () => {
    // Batches are cached for the session (staleTime: Infinity), so the file
    // manager has to evict explicitly or FILE cells show the stale name.
    getFileRefStoreState().requestHydration([REF_A])
    getFileRefStoreState().startBatch(100)
    getFileRefStoreState().completeBatch([detail(REF_A, 'old.png')], [REF_A])

    invalidateFileRefs([REF_A])
    expect(useFileRefStore.getState().dataMap[REF_A]).toBeUndefined()

    getFileRefStoreState().requestHydration([REF_A])
    expect(getFileRefStoreState().startBatch(100)).toEqual([REF_A])
  })
})
