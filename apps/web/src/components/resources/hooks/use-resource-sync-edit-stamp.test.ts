// apps/web/src/components/resources/hooks/use-resource-sync-edit-stamp.test.ts
//
// 74-D1 §1.2.1 "Live": `record:updated` carries the `edit` stamp, and the store
// merges it exactly as it merges the denormalised columns — `null` closes the
// edit, absent leaves it alone, so a frame about a display name cannot silently
// unlock a posted document.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  onRecordEvent: undefined as ((event: string, payload: unknown) => void) | undefined,
  getByIdsFetch: vi.fn<(input: any, opts: any) => Promise<any>>(async () => ({})),
  refetch: vi.fn(async () => {}),
}))

vi.mock('~/realtime/hooks', () => ({
  useRecordChannels: (_defIds: readonly string[], handlers: any) => {
    h.onRecordEvent = handlers?.onEvent
  },
  useOrgChannel: () => false,
}))

vi.mock('../store/field-value-fetch-queue', () => ({
  fieldValueFetchQueue: { refetch: h.refetch },
}))

const utils = {
  record: {
    listFiltered: { invalidate: vi.fn() },
    getByIds: { fetch: h.getByIdsFetch },
  },
  resource: { list: { invalidate: vi.fn() } },
  entityDefinition: {
    getAll: { invalidate: vi.fn() },
    getBySlug: { invalidate: vi.fn() },
    getById: { invalidate: vi.fn() },
  },
}

vi.mock('~/trpc/react', () => ({ api: { useUtils: () => utils } }))

const { useResourceSync } = await import('./use-resource-sync')
const { getRecordStoreState } = await import('../store/record-store')

const DEF = 'cmadefaaaaaaaaaaaaaaaaaa'
const BILL = 'bil_00000000000000000000'
const STAMP = { openedAt: '2026-09-19T10:00:00.000Z', byUserId: 'usr_member00000000000000' }

beforeEach(() => {
  vi.useFakeTimers()
  h.onRecordEvent = undefined
  getRecordStoreState().clearAll()
  getRecordStoreState().setRecords(DEF, [{ id: BILL, displayName: 'BILL-0001' } as any])
})

function stored() {
  return getRecordStoreState().records[DEF]?.get(BILL) as { edit?: unknown; displayName?: string }
}

describe('record:updated — the edit stamp', () => {
  it('applies an open edit', () => {
    renderHook(() => useResourceSync())
    h.onRecordEvent?.('record:updated', {
      entityDefinitionId: DEF,
      record: { id: BILL, recordId: `${DEF}:${BILL}`, edit: STAMP },
    })
    expect(stored().edit).toEqual(STAMP)
  })

  it('clears it on `null` and leaves it alone when the key is absent', () => {
    renderHook(() => useResourceSync())
    h.onRecordEvent?.('record:updated', {
      entityDefinitionId: DEF,
      record: { id: BILL, recordId: `${DEF}:${BILL}`, edit: STAMP },
    })

    h.onRecordEvent?.('record:updated', {
      entityDefinitionId: DEF,
      record: { id: BILL, recordId: `${DEF}:${BILL}`, displayName: 'BILL-0002' },
    })
    expect(stored().edit).toEqual(STAMP)
    expect(stored().displayName).toBe('BILL-0002')

    h.onRecordEvent?.('record:updated', {
      entityDefinitionId: DEF,
      record: { id: BILL, recordId: `${DEF}:${BILL}`, edit: null },
    })
    expect(stored().edit).toBeNull()
  })
})
