// packages/lib/src/entity-instances/__tests__/edit-snapshot.test.ts
//
// The edit-in-place primitives (74-D1): the first Edit wins, Cancel puts the
// header and every content child back through the ordinary write path, and the
// stamp reads never touch the `snapshot` column.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const handler = vi.hoisted(() => ({
  update: vi.fn(async () => ({})),
  create: vi.fn(async () => ({})),
  delete: vi.fn(async () => undefined),
}))

const cache = vi.hoisted(() => ({
  resourceFields: {} as Record<string, unknown[]>,
  customFields: {} as Record<string, unknown[]>,
}))

const snapshots = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('../../cache', () => ({
  getCachedResourceFields: vi.fn(
    async (_org: string, defId: string) => cache.resourceFields[defId] ?? []
  ),
  getCachedCustomFields: vi.fn(
    async (_org: string, defId: string) => cache.customFields[defId] ?? []
  ),
}))

vi.mock('../../record-rules/snapshot-fetcher', () => ({
  fetchResourceSnapshots: snapshots.fetch,
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({ publish: vi.fn(async () => true) }),
  rooms: { orgRecords: (org: string, def: string) => `${org}:${def}` },
}))

vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    update = handler.update
    create = handler.create
    delete = handler.delete
  },
}))

const { captureRecordSnapshot, readEditStamps, restoreRecordSnapshot, deleteEditSnapshot } =
  await import('../edit-snapshot')

const ORG = 'org_abgwpa1l81reht2zmwrcih'
const USER = 'usr_member00000000000000'
const BILL_DEF = 'def_bill0000000000000000'
const LINE_DEF = 'def_line0000000000000000'
const BILL = 'bil_00000000000000000000'

const LINE_KEPT = 'lin_kept0000000000000000'
const LINE_ADDED = 'lin_added000000000000000'
const LINE_GONE = 'lin_gone0000000000000000'

/** The two fields the restore is allowed to write back, plus the ones it must not. */
function billFields() {
  return [
    field('vendor_bill_note', { updatable: true, creatable: true }),
    field('vendor_bill_payment_status', { updatable: false, creatable: false, computed: true }),
    // A projection whose registry entry is still `updatable` — skipped by name.
    field('vendor_bill_amount_paid', { updatable: true, creatable: true }),
    {
      ...field('vendor_bill_lines', { updatable: true, creatable: true }),
      key: 'lines',
      relationship: {
        relationshipType: 'has_many',
        inverseResourceFieldId: `${LINE_DEF}:fld_bill`,
      },
    },
  ]
}

function lineFields() {
  return [
    field('vendor_bill_line_qty', { updatable: true, creatable: true }),
    {
      ...field('vendor_bill_line_bill', { updatable: true, creatable: true }),
      relationship: { relationshipType: 'belongs_to' },
    },
  ]
}

function field(systemAttribute: string, capabilities: Record<string, boolean>) {
  return {
    id: systemAttribute,
    key: systemAttribute,
    label: systemAttribute,
    systemAttribute,
    capabilities: { filterable: false, sortable: false, configurable: false, ...capabilities },
  }
}

/**
 * A `db` driven by a queue of SELECT results. Every builder shape this module
 * uses is a thenable, which is what a Drizzle builder is.
 */
function makeDb(selectResults: unknown[][]) {
  const queue = [...selectResults]
  const state = {
    selectColumns: [] as unknown[],
    inserted: [] as unknown[],
    deletes: 0,
    instance: { id: BILL, entityDefinitionId: BILL_DEF } as unknown,
  }
  const thenable = (rows: unknown) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.limit = () => chain
    chain.returning = () => chain
    // biome-ignore lint/suspicious/noThenProperty: a Drizzle builder IS a thenable
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej)
    return chain
  }
  const db = {
    select: (columns: unknown) => {
      state.selectColumns.push(columns)
      return thenable(queue.shift() ?? [])
    },
    insert: () => ({
      values: (values: unknown) => {
        state.inserted.push(values)
        return { onConflictDoNothing: async () => undefined }
      },
    }),
    delete: () => {
      state.deletes += 1
      return thenable([{ id: 'row' }])
    },
    query: { EntityInstance: { findFirst: async () => state.instance } },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }
  return { db: db as never, state }
}

beforeEach(() => {
  vi.clearAllMocks()
  cache.resourceFields = { [BILL_DEF]: billFields(), [LINE_DEF]: lineFields() }
  cache.customFields = {
    [BILL_DEF]: [
      {
        id: 'fld_lines',
        systemAttribute: 'vendor_bill_lines',
        options: {
          relationship: {
            relationshipType: 'has_many',
            inverseResourceFieldId: `${LINE_DEF}:fld_bill`,
          },
        },
      },
    ],
  }
})

describe('captureRecordSnapshot', () => {
  it('snapshots the header and its named children, and stamps the capture', async () => {
    snapshots.fetch.mockImplementation(async (_db, _org, recordIds: string[]) => {
      const map = new Map()
      for (const recordId of recordIds) {
        const [defId, id] = recordId.split(':')
        map.set(recordId, { id, entityDefinitionId: defId, fieldValues: { probe: id } })
      }
      return map
    })
    const capturedAt = new Date('2026-09-19T10:00:00.000Z')
    const { db, state } = makeDb([
      [], // no existing row
      [{ entityId: LINE_KEPT }, { entityId: LINE_GONE }], // the bill's lines
      [{ capturedAt, byUserId: USER }], // the re-read after insert
    ])

    const stamp = await captureRecordSnapshot(db, {
      organizationId: ORG,
      entityInstanceId: BILL,
      children: ['lines'],
      byUserId: USER,
    })

    expect(stamp).toEqual({ openedAt: '2026-09-19T10:00:00.000Z', byUserId: USER })
    expect(state.inserted).toHaveLength(1)
    const row = state.inserted[0] as { snapshot: { children: Record<string, unknown[]> } }
    expect(row.snapshot.children.lines).toHaveLength(2)
  })

  it('keeps the first stamp and inserts nothing on a second Edit (66 D9)', async () => {
    const capturedAt = new Date('2026-09-19T09:00:00.000Z')
    const { db, state } = makeDb([[{ capturedAt, byUserId: 'usr_first0000000000000000' }]])

    const stamp = await captureRecordSnapshot(db, {
      organizationId: ORG,
      entityInstanceId: BILL,
      children: ['lines'],
      byUserId: USER,
    })

    expect(stamp.byUserId).toBe('usr_first0000000000000000')
    expect(state.inserted).toHaveLength(0)
    expect(snapshots.fetch).not.toHaveBeenCalled()
  })
})

describe('readEditStamps', () => {
  it('reads one query and never selects the snapshot column', async () => {
    const capturedAt = new Date('2026-09-19T10:00:00.000Z')
    const { db, state } = makeDb([[{ entityInstanceId: BILL, capturedAt, byUserId: USER }]])

    const stamps = await readEditStamps(db, ORG, [BILL, 'bil_other0000000000000000', BILL])

    expect(stamps.get(BILL)).toEqual({ openedAt: '2026-09-19T10:00:00.000Z', byUserId: USER })
    expect(stamps.has('bil_other0000000000000000')).toBe(false)
    expect(state.selectColumns).toHaveLength(1)
    expect(Object.keys(state.selectColumns[0] as object).sort()).toEqual([
      'byUserId',
      'capturedAt',
      'entityInstanceId',
    ])
  })

  it('answers an empty batch without a query', async () => {
    const { db, state } = makeDb([])
    expect((await readEditStamps(db, ORG, [])).size).toBe(0)
    expect(state.selectColumns).toHaveLength(0)
  })
})

describe('restoreRecordSnapshot', () => {
  const snapshot = {
    record: {
      id: BILL,
      entityDefinitionId: BILL_DEF,
      fieldValues: {
        vendor_bill_note: 'before',
        vendor_bill_payment_status: 'unpaid',
        vendor_bill_amount_paid: 0,
        vendor_bill_lines: LINE_KEPT,
      },
    },
    children: {
      lines: [
        {
          id: LINE_KEPT,
          entityDefinitionId: LINE_DEF,
          fieldValues: { vendor_bill_line_qty: 3, vendor_bill_line_bill: BILL },
        },
        {
          id: LINE_GONE,
          entityDefinitionId: LINE_DEF,
          fieldValues: { vendor_bill_line_qty: 1, vendor_bill_line_bill: BILL },
        },
      ],
    },
  }

  it('round-trips the header and every child, then drops the row last', async () => {
    const { db, state } = makeDb([
      [{ entityDefinitionId: BILL_DEF, snapshot }], // the snapshot row
      [{ entityId: LINE_KEPT }, { entityId: LINE_ADDED }], // the live lines
      [{ id: BILL, entityDefinitionId: BILL_DEF }], // survivor's belongs_to encode
      [{ id: BILL, entityDefinitionId: BILL_DEF }], // recreated line's belongs_to encode
    ])

    await restoreRecordSnapshot(db, {
      organizationId: ORG,
      entityInstanceId: BILL,
      actorUserId: USER,
    })

    // The header: only the writable, non-computed, non-projected attribute.
    expect(handler.update).toHaveBeenCalledWith(`${BILL_DEF}:${BILL}`, {
      vendor_bill_note: 'before',
    })
    // The survivor goes back to its captured quantity, with the back-link as a RecordId.
    expect(handler.update).toHaveBeenCalledWith(`${LINE_DEF}:${LINE_KEPT}`, {
      vendor_bill_line_qty: 3,
      vendor_bill_line_bill: `${BILL_DEF}:${BILL}`,
    })
    // The line added during the edit is deleted; the removed one is recreated (66 D8).
    expect(handler.delete).toHaveBeenCalledWith(`${LINE_DEF}:${LINE_ADDED}`)
    expect(handler.create).toHaveBeenCalledWith(LINE_DEF, {
      vendor_bill_line_qty: 1,
      vendor_bill_line_bill: `${BILL_DEF}:${BILL}`,
    })
    expect(state.deletes).toBe(1)
  })

  it('never writes back a guarded lifecycle status', async () => {
    const MEMO_DEF = 'def_memo0000000000000000'
    const MEMO = 'cme_00000000000000000000'
    cache.resourceFields[MEMO_DEF] = [
      field('credit_memo_note', { updatable: true, creatable: true }),
      // `updatable` in the registry, but the settlement writer owns it and both
      // write chains guard it — restoring it would be refused outright.
      field('credit_memo_status', { updatable: true, creatable: true }),
    ]
    const { db } = makeDb([
      [
        {
          entityDefinitionId: MEMO_DEF,
          snapshot: {
            record: {
              id: MEMO,
              entityDefinitionId: MEMO_DEF,
              fieldValues: { credit_memo_note: 'before', credit_memo_status: 'issued' },
            },
            children: {},
          },
        },
      ],
    ])

    await restoreRecordSnapshot(db, {
      organizationId: ORG,
      entityInstanceId: MEMO,
      actorUserId: USER,
    })

    expect(handler.update).toHaveBeenCalledWith(`${MEMO_DEF}:${MEMO}`, {
      credit_memo_note: 'before',
    })
  })

  it('refuses by name when no edit is open', async () => {
    const { db } = makeDb([[]])
    await expect(
      restoreRecordSnapshot(db, {
        organizationId: ORG,
        entityInstanceId: BILL,
        actorUserId: USER,
      })
    ).rejects.toThrow(/No open edit/)
  })
})

describe('deleteEditSnapshot', () => {
  it('reports whether a row was there', async () => {
    const { db } = makeDb([])
    expect(await deleteEditSnapshot(db, ORG, BILL)).toBe(true)
  })
})
