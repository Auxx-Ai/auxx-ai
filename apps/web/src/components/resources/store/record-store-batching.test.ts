// apps/web/src/components/resources/store/record-store-batching.test.ts
// Hardening-plan Part 8: startBatch is the single canonicalizing drain —
// alias+canonical dedupe, per-id gating, canonical loading keys.

import { beforeEach, describe, expect, it } from 'vitest'
import { getRecordStoreState } from './record-store'
import { getRelationshipStoreState, useRelationshipStore } from './relationship-store'
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

beforeEach(() => {
  getResourceStoreState().reset()
  getRecordStoreState().clearAll()
  getRelationshipStoreState().reset()
})

describe('recordStore.startBatch', () => {
  it('collapses alias + canonical duplicates into one request slot', () => {
    const store = getRecordStoreState()

    // Pre-hydration: the alias can't normalize at entry, so both forms of the
    // same record occupy separate pending slots — the classic double-queue.
    store.requestRecord('work_order:x')
    store.requestRecord(`${WORK_ORDER_DEF}:x`)
    expect(getRecordStoreState().pendingFetchIds.size).toBe(2)

    // Hydration arrives; the drain must collapse both into ONE canonical id.
    getResourceStoreState().setResources([workOrderResource])
    const batch = getRecordStoreState().startBatch()
    expect(batch).toEqual([`${WORK_ORDER_DEF}:x`])
    expect(getRecordStoreState().pendingFetchIds.size).toBe(0)
    expect(getRecordStoreState().loadingIds.has(`${WORK_ORDER_DEF}:x`)).toBe(true)
  })

  it('flushes statically-canonical ids while unresolved aliases stay pending', () => {
    const store = getRecordStoreState()
    store.requestRecord('thread:t1') // legacy — statically canonical
    store.requestRecord('work_order:w1') // dynamic alias — no mapping yet

    const batch = getRecordStoreState().startBatch()
    expect(batch).toEqual(['thread:t1'])
    expect(getRecordStoreState().pendingFetchIds.has('work_order:w1')).toBe(true)

    // Mapping arrives — the pending alias releases exactly once
    getResourceStoreState().setResources([workOrderResource])
    const second = getRecordStoreState().startBatch()
    expect(second).toEqual([`${WORK_ORDER_DEF}:w1`])
    expect(getRecordStoreState().pendingFetchIds.size).toBe(0)
    expect(getRecordStoreState().startBatch()).toEqual([])
  })

  it('duplicates do not reduce effective batch size (dedupe before slice)', () => {
    const store = getRecordStoreState()
    // Pre-hydration: 60 unique records, each queued in both alias and
    // canonical form → 120 queued entries. After hydration the batch must
    // still contain all 60 unique ids (slicing before dedupe would drop 10).
    for (let i = 0; i < 60; i++) {
      store.requestRecord(`work_order:r${i}`)
      store.requestRecord(`${WORK_ORDER_DEF}:r${i}`)
    }
    expect(getRecordStoreState().pendingFetchIds.size).toBe(120)
    getResourceStoreState().setResources([workOrderResource])
    const batch = getRecordStoreState().startBatch()
    expect(batch).toHaveLength(60)
    expect(new Set(batch).size).toBe(60)
    expect(batch.every((id) => id.startsWith(`${WORK_ORDER_DEF}:`))).toBe(true)
  })
})

describe('relationshipStore.startBatch', () => {
  it('alias + canonical share one hydration slot; unresolved ids stay pending', () => {
    const wrapper = getRelationshipStoreState()
    wrapper.requestHydration(['thread:t1', 'work_order:w1'])
    // pre-hydration: work_order alias queued as-is
    let batch = getRelationshipStoreState().startBatch(100)
    expect(batch).toEqual(['thread:t1'])
    expect(useRelationshipStore.getState().pendingIds.has('work_order:w1')).toBe(true)
    expect(useRelationshipStore.getState().loadingIds.has('thread:t1')).toBe(true)

    getResourceStoreState().setResources([workOrderResource])
    // Also queue the canonical form — must collapse with the pending alias
    getRelationshipStoreState().requestHydration([`${WORK_ORDER_DEF}:w1`])
    batch = getRelationshipStoreState().startBatch(100)
    expect(batch).toEqual([`${WORK_ORDER_DEF}:w1`])
    expect(useRelationshipStore.getState().pendingIds.size).toBe(0)
    expect(useRelationshipStore.getState().loadingIds.has(`${WORK_ORDER_DEF}:w1`)).toBe(true)
  })
})
