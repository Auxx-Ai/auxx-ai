// apps/web/src/components/resources/store/field-value-fetch-queue.test.ts
// Hardening-plan Parts 0/4/7/8: O(1) Map dedupe, both-halves re-keying,
// org-reset generation guard, no timer polling, linear batch growth.

import type { RecordId } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldValueFetchQueue } from './field-value-fetch-queue'
import { useFieldValueStore } from './field-value-store'
import { getResourceStoreState } from './resource-store'

const WORK_ORDER_DEF = 'cmworkorderdef12345678'

const workOrderResource = {
  id: WORK_ORDER_DEF,
  type: 'custom',
  apiSlug: 'work_orders',
  entityType: 'work_order',
  entityDefinitionId: WORK_ORDER_DEF,
  organizationId: 'org_1',
  label: 'Work Order',
  plural: 'Work Orders',
  icon: 'wrench',
  color: 'blue',
  isVisible: true,
  fields: [],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
} as any

type FetchCall = { recordIds: RecordId[]; fieldReferences: FieldReference[] }

function makeFetchFn(calls: FetchCall[]) {
  return vi.fn(async (params: FetchCall) => {
    calls.push(params)
    return {
      values: params.recordIds.flatMap((recordId) =>
        params.fieldReferences.map((fieldRef) => ({
          recordId,
          fieldRef,
          value: `v:${recordId}`,
        }))
      ),
    }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fieldValueFetchQueue.reset()
  fieldValueFetchQueue.setDebounceMs(0)
  getResourceStoreState().reset()
  useFieldValueStore.getState().clearAll()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('enqueue dedupe', () => {
  it('produces exactly one entry per FieldValueKey (alias + canonical collapse)', async () => {
    getResourceStoreState().setResources([workOrderResource])
    const calls: FetchCall[] = []
    fieldValueFetchQueue.setFetchFn(makeFetchFn(calls))

    // Same cell requested via alias record, canonical record, alias fieldRef —
    // all must map to ONE canonical key and ONE request combination.
    fieldValueFetchQueue.queueFetchBatch([
      { recordId: 'work_order:r1', fieldRef: 'work_order:f1' as FieldReference },
      { recordId: `${WORK_ORDER_DEF}:r1`, fieldRef: `${WORK_ORDER_DEF}:f1` as FieldReference },
      { recordId: 'work_orders:r1', fieldRef: `${WORK_ORDER_DEF}:f1` as FieldReference },
    ])

    await vi.runAllTimersAsync()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.recordIds).toEqual([`${WORK_ORDER_DEF}:r1`])
    expect(calls[0]!.fieldReferences).toEqual([`${WORK_ORDER_DEF}:f1`])
    expect(useFieldValueStore.getState().values[`${WORK_ORDER_DEF}:r1:${WORK_ORDER_DEF}:f1`]).toBe(
      `v:${WORK_ORDER_DEF}:r1`
    )
  })
})

describe('pre-hydration re-keying', () => {
  it('rekeys BOTH RecordId and fieldRef halves when the mapping arrives', async () => {
    const calls: FetchCall[] = []
    fieldValueFetchQueue.setFetchFn(makeFetchFn(calls))

    // No mapping yet — entry queues under the alias key and must NOT flush.
    fieldValueFetchQueue.queueFetch('work_order:r1', 'work_order:f1' as FieldReference)
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(0)
    // Alias fetching marker present pre-hydration (skeleton stays up)
    expect(useFieldValueStore.getState().isKeyFetching('work_order:r1:work_order:f1')).toBe(true)

    // Mapping arrives → prefix-map subscription schedules the flush.
    getResourceStoreState().setResources([workOrderResource])
    await vi.runAllTimersAsync()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.recordIds).toEqual([`${WORK_ORDER_DEF}:r1`])
    expect(calls[0]!.fieldReferences).toEqual([`${WORK_ORDER_DEF}:f1`])
    // Stale alias marker swapped for the canonical one, value landed canonical
    const state = useFieldValueStore.getState()
    expect(state.isKeyFetching('work_order:r1:work_order:f1')).toBe(false)
    expect(state.values[`${WORK_ORDER_DEF}:r1:${WORK_ORDER_DEF}:f1`]).toBe(`v:${WORK_ORDER_DEF}:r1`)
  })

  it('leaves no recurring timer when resources never hydrate (no polling)', async () => {
    const calls: FetchCall[] = []
    fieldValueFetchQueue.setFetchFn(makeFetchFn(calls))
    fieldValueFetchQueue.queueFetch('work_order:r1', 'work_order:f1' as FieldReference)

    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(0)
    // runAllTimersAsync would loop forever on a self-rescheduling timer; the
    // stronger assertion is that no timer remains at all:
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flushes statically-canonical ids immediately even with no seed', async () => {
    const calls: FetchCall[] = []
    fieldValueFetchQueue.setFetchFn(makeFetchFn(calls))
    fieldValueFetchQueue.queueFetch('thread:t1', 'thread:subject' as FieldReference)

    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.recordIds).toEqual(['thread:t1'])
  })
})

describe('org reset / generation guard', () => {
  it('reset cancels pending work', async () => {
    const calls: FetchCall[] = []
    fieldValueFetchQueue.setFetchFn(makeFetchFn(calls))
    fieldValueFetchQueue.queueFetch('thread:t1', 'thread:subject' as FieldReference)

    fieldValueFetchQueue.reset()
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards an old-generation response after reset (no writes into new stores)', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fieldValueFetchQueue.setFetchFn(async (params) => {
      await gate
      return {
        values: params.recordIds.map((recordId) => ({
          recordId,
          fieldRef: params.fieldReferences[0]!,
          value: 'stale-org-value',
        })),
      }
    })

    fieldValueFetchQueue.queueFetch('thread:t1', 'thread:subject' as FieldReference)
    await vi.advanceTimersByTimeAsync(1) // start the flush; fetch is in flight

    // Org switch mid-flight
    fieldValueFetchQueue.reset()
    useFieldValueStore.getState().clearAll()

    release()
    await vi.runAllTimersAsync()
    await Promise.resolve()

    const state = useFieldValueStore.getState()
    expect(Object.keys(state.values)).toHaveLength(0)
    expect(Object.keys(state.fetchingKeys)).toHaveLength(0)
    expect(Object.keys(state.loadingBatches)).toHaveLength(0)
  })
})

describe('batch scaling (Part 0 benchmark, operation-shape assertions)', () => {
  it('10k combinations enqueue via Map dedupe and produce one canonical request set', async () => {
    getResourceStoreState().setResources([workOrderResource])
    const calls: FetchCall[] = []
    fieldValueFetchQueue.setFetchFn(makeFetchFn(calls))

    const RECORDS = 1000
    const FIELDS = 10
    const requests: Array<{ recordId: RecordId; fieldRef: FieldReference }> = []
    for (let r = 0; r < RECORDS; r++) {
      for (let f = 0; f < FIELDS; f++) {
        requests.push({
          recordId: `work_order:r${r}`,
          fieldRef: `${WORK_ORDER_DEF}:f${f}` as FieldReference,
        })
      }
    }

    const start = performance.now()
    const queued = fieldValueFetchQueue.queueFetchBatch(requests)
    const enqueueMs = performance.now() - start
    // eslint-disable-next-line no-console
    console.log(`[benchmark] enqueue ${RECORDS * FIELDS} combinations: ${enqueueMs.toFixed(1)}ms`)

    expect(queued).toHaveLength(RECORDS * FIELDS)
    // Every key canonical, no alias slots
    expect(queued.every((k) => k.startsWith(`${WORK_ORDER_DEF}:`))).toBe(true)

    await vi.runAllTimersAsync()
    // 1000 records / BATCH_SIZE(100) = 10 chunks, all sharing the field set
    expect(calls).toHaveLength(10)
    expect(calls[0]!.fieldReferences).toHaveLength(FIELDS)
    const requestedRecords = new Set(calls.flatMap((c) => c.recordIds))
    expect(requestedRecords.size).toBe(RECORDS)
  })

  it('duplicate-heavy alias/canonical mix collapses to unique combinations', () => {
    getResourceStoreState().setResources([workOrderResource])
    fieldValueFetchQueue.setFetchFn(makeFetchFn([]))

    const requests: Array<{ recordId: RecordId; fieldRef: FieldReference }> = []
    for (let r = 0; r < 200; r++) {
      for (const prefix of ['work_order', 'work_orders', WORK_ORDER_DEF]) {
        requests.push({
          recordId: `${prefix}:r${r}`,
          fieldRef: 'work_order:f1' as FieldReference,
        })
      }
    }
    const queued = fieldValueFetchQueue.queueFetchBatch(requests)
    expect(queued).toHaveLength(200) // 600 inputs → 200 unique canonical keys
  })
})
