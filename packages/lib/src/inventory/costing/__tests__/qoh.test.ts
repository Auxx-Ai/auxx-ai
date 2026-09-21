// packages/lib/src/inventory/costing/__tests__/qoh.test.ts
//
// The batch QoH write, against a stubbed `FieldValue` table.
//
// 🛑 What is under test is the WRITE SHAPE, not the SUM. The per-movement field
// hook writes the same two rows for the same part right after the same commit,
// so this write has to be idempotent under concurrency: an upsert on
// `(entityId, fieldId, sortKey)`, never a delete followed by an insert that a
// hook row can land in the middle of.

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  organizationId: string
  entityId: string
  fieldId: string
  sortKey: string
  valueNumber: number | null
  optionId: string | null
  updatedAt?: Date
}

const h = vi.hoisted(() => ({
  table: [] as Row[],
  selectResults: [] as unknown[][],
  deletes: 0,
}))

/** A thenable that answers every chained builder call with itself. */
function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then')
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject)
        return () => proxy
      },
    }
  )
  return proxy
}

function insertChain() {
  let pending: Row[] = []
  const api = {
    values(rows: Row[]) {
      pending = rows
      return api
    },
    async onConflictDoUpdate(_config: unknown) {
      for (const row of pending) {
        const existing = h.table.find(
          (candidate) =>
            candidate.entityId === row.entityId &&
            candidate.fieldId === row.fieldId &&
            candidate.sortKey === row.sortKey
        )
        if (existing) {
          existing.valueNumber = row.valueNumber
          existing.optionId = row.optionId
          existing.updatedAt = new Date()
        } else {
          h.table.push({ ...row })
        }
      }
    },
  }
  return api
}

vi.mock('@auxx/database', () => {
  const column = (name: string) => ({ name })
  return {
    schema: {
      EntityInstance: {
        id: column('id'),
        organizationId: column('organizationId'),
        entityDefinitionId: column('entityDefinitionId'),
        createdAt: column('createdAt'),
        updatedAt: column('updatedAt'),
        archivedAt: column('archivedAt'),
        displayName: column('displayName'),
      },
      FieldValue: {
        organizationId: column('organizationId'),
        entityId: column('entityId'),
        fieldId: column('fieldId'),
        sortKey: column('sortKey'),
        valueNumber: column('valueNumber'),
        optionId: column('optionId'),
        updatedAt: column('updatedAt'),
      },
    },
    database: {
      select: () => chain(h.selectResults.shift() ?? []),
      insert: () => insertChain(),
      delete: () => {
        h.deletes++
        return chain([])
      },
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: () => insertChain(),
          delete: () => {
            h.deletes++
            return chain([])
          },
        }),
    },
  }
})

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        stock_movement_quantity: { id: 'f_qty', type: 'NUMBER' },
        stock_movement_part: { id: 'f_part', type: 'RELATIONSHIP' },
        stock_movement_adjust_subparts: { id: 'f_flag', type: 'CHECKBOX' },
        part_quantity_on_hand: { id: 'f_qoh', type: 'NUMBER' },
        part_reorder_point: { id: 'f_rop', type: 'NUMBER' },
        part_stock_status: { id: 'f_status', type: 'SINGLE_SELECT' },
      }),
    }),
  }),
  requireCachedEntityDefId: async () => 'def_part',
}))

vi.mock('../../../field-values/field-value-mutations', () => ({
  buildFieldValueRow: (params: {
    organizationId: string
    entityId: string
    fieldId: string
    sortKey: string
    value: { type: string; value?: number; optionId?: string }
  }): Row => ({
    organizationId: params.organizationId,
    entityId: params.entityId,
    fieldId: params.fieldId,
    sortKey: params.sortKey,
    valueNumber: params.value.type === 'number' ? (params.value.value ?? null) : null,
    optionId: params.value.type === 'option' ? (params.value.optionId ?? null) : null,
  }),
}))

vi.mock('../../../field-values/stored-field-type', () => ({ toFieldType: (type: string) => type }))

vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: async () => {},
}))

import { batchRecalculateQoH } from '../qoh'

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const BEARING = 'bshz9zebd46opwqexgdr2bba'
const MOTOR = 'd5jaco74nvh4zvkrhfzj83tz'

/** The two SELECTs `batchRecalculateQoH` makes: the grouped SUM, then reorder points. */
function stubReads(sums: Array<{ partId: string; total: string }>) {
  h.selectResults = [sums, []]
}

function rowsFor(entityId: string, fieldId: string): Row[] {
  return h.table.filter((row) => row.entityId === entityId && row.fieldId === fieldId)
}

beforeEach(() => {
  h.table = []
  h.selectResults = []
  h.deletes = 0
})

describe('the batch QoH write', () => {
  it('upserts rather than deleting and re-inserting', async () => {
    stubReads([{ partId: MOTOR, total: '100' }])
    await batchRecalculateQoH(ORG, [MOTOR])

    expect(h.deletes).toBe(0)
    expect(h.table).toHaveLength(2)
  })

  it('leaves the row count stable across two runs', async () => {
    stubReads([{ partId: MOTOR, total: '100' }])
    await batchRecalculateQoH(ORG, [MOTOR])
    const first = h.table.length

    stubReads([{ partId: MOTOR, total: '100' }])
    await batchRecalculateQoH(ORG, [MOTOR])

    expect(h.table).toHaveLength(first)
  })

  it('updates a row the per-movement hook already wrote, never duplicating it', async () => {
    // The hook's row, written between the batch's read and its write.
    h.table.push({
      organizationId: ORG,
      entityId: MOTOR,
      fieldId: 'f_qoh',
      sortKey: 'a0',
      valueNumber: 40,
      optionId: null,
    })

    stubReads([{ partId: MOTOR, total: '100' }])
    await batchRecalculateQoH(ORG, [MOTOR])

    const qoh = rowsFor(MOTOR, 'f_qoh')
    expect(qoh).toHaveLength(1)
    expect(qoh[0]!.valueNumber).toBe(100)
  })

  it('sets the received part on hand and in stock', async () => {
    // The receipt from the browser test: Motor 590 received 100.
    stubReads([
      { partId: BEARING, total: '100' },
      { partId: MOTOR, total: '100' },
    ])
    await batchRecalculateQoH(ORG, [BEARING, MOTOR])

    expect(rowsFor(MOTOR, 'f_qoh')[0]!.valueNumber).toBe(100)
    expect(rowsFor(MOTOR, 'f_status')[0]!.optionId).toBe('in_stock')
    expect(rowsFor(BEARING, 'f_qoh')[0]!.valueNumber).toBe(100)
  })

  it('writes zero on hand and out of stock for a part with no movements', async () => {
    stubReads([])
    await batchRecalculateQoH(ORG, [MOTOR])

    expect(rowsFor(MOTOR, 'f_qoh')[0]!.valueNumber).toBe(0)
    expect(rowsFor(MOTOR, 'f_status')[0]!.optionId).toBe('out_of_stock')
  })
})
