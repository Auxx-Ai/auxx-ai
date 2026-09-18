// packages/lib/src/resources/system-records/__tests__/read.test.ts
//
// The reader every module in the accounting cluster re-typed. What matters is
// the query SHAPE (two selects, chunked), the cell typing through
// `rowsToTypedValues`, and `sortKey` order on a multi-value field — the evidence
// pack depends on that order (plan §3d).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ select: vi.fn() }))

vi.mock('@auxx/database', async () => ({
  schema: await import('../../../../../database/src/db/schema/index'),
  database: (await import('../../../test/database-mock')).createChainableDatabaseMock(),
}))

import { schema } from '@auxx/database'
import type { SystemFieldContext } from '../fields'
import { inPageOrder, readSystemRecords } from '../read'

type Attribute =
  | 'name'
  | 'handles'
  | 'status'
  | 'order'
  | 'placed_at'
  | 'amount'
  | 'billable'
  | 'inspected_by'

const ORG = 'org_1'

const ctx: SystemFieldContext<Attribute> = {
  defId: 'def_1',
  fields: {
    name: field('f_name', 'TEXT'),
    handles: field('f_handles', 'TAGS'),
    status: field('f_status', 'SINGLE_SELECT'),
    order: field('f_order', 'RELATIONSHIP'),
    placed_at: field('f_placed', 'DATE'),
    amount: field('f_amount', 'NUMBER'),
    billable: field('f_billable', 'CHECKBOX'),
    inspected_by: field('f_inspected', 'ACTOR'),
  },
}

// biome-ignore lint/suspicious/noExplicitAny: a CustomField stand-in, only `id` and `type` are read
function field(id: string, type: string): any {
  return { id, type }
}

function valueRow(entityId: string, fieldId: string, sortKey: string, columns: object) {
  return {
    id: `${entityId}:${fieldId}:${sortKey}`,
    entityId,
    fieldId,
    sortKey,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...columns,
  }
}

/**
 * A db whose every `select().from(t).where().orderBy()` answers from `rows`,
 * keyed by table, recording each call so a test can count queries.
 */
function db(rows: { instances?: unknown[]; values?: unknown[]; children?: unknown[] }) {
  const calls: { table: unknown; columns: unknown }[] = []
  h.select.mockImplementation((table: unknown, columns: unknown) => {
    calls.push({ table, columns })
    if (table === schema.EntityInstance) return rows.instances ?? []
    // A `{ entityId }` projection is the child-by-parent lookup; the values read
    // takes whole rows.
    if (columns) return rows.children ?? []
    return rows.values ?? []
  })
  const conn = {
    select: (columns?: unknown) => ({
      from: (table: unknown) => ({
        where: () => {
          const result = Promise.resolve(h.select(table, columns))
          // The values read chains `.orderBy(sortKey)`; the others await here.
          return Object.assign(result, { orderBy: () => result })
        },
      }),
    }),
  }
  // biome-ignore lint/suspicious/noExplicitAny: a query-builder stand-in
  return { conn: conn as any, calls }
}

function instance(id: string, extra: object = {}) {
  return {
    id,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    archivedAt: null,
    ...extra,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('readSystemRecords', () => {
  it('reads instances and their values in TWO queries', async () => {
    const { conn, calls } = db({
      instances: [instance('a'), instance('b')],
      values: [valueRow('a', 'f_name', 'a0', { valueText: 'Stripe' })],
    })

    const rows = await readSystemRecords(conn, ORG, ctx)

    expect(calls).toHaveLength(2)
    expect(rows.map((row) => row.id)).toEqual(['a', 'b'])
    expect(rows[0]?.text('name')).toBe('Stripe')
    expect(rows[0]?.recordId).toBe('def_1:a')
    // A record with no stored row reads as unset, never as another record's value.
    expect(rows[1]?.text('name')).toBeNull()
  })

  it('types a cell through rowsToTypedValues rather than guessing a column', async () => {
    const { conn } = db({
      instances: [instance('a')],
      values: [
        valueRow('a', 'f_status', 'a0', { optionId: 'open' }),
        valueRow('a', 'f_amount', 'a0', { valueNumber: 1250 }),
        valueRow('a', 'f_placed', 'a0', { valueDate: '2026-02-03' }),
        valueRow('a', 'f_order', 'a0', {
          relatedEntityId: 'inst_o1',
          relatedEntityDefinitionId: 'def_order',
        }),
      ],
    })

    const [row] = await readSystemRecords(conn, ORG, ctx)

    expect(row?.cell('status')).toMatchObject({ type: 'option', optionId: 'open' })
    expect(row?.option('status')).toBe('open')
    expect(row?.number('amount')).toBe(1250)
    expect(row?.date('placed_at')).toBe('2026-02-03')
    // `related` hands back the INSTANCE id; the cell still carries the RecordId.
    expect(row?.related('order')).toBe('inst_o1')
    expect(row?.cell('order')).toMatchObject({ recordId: 'def_order:inst_o1' })
    // A typed read of the wrong shape is null, not a coerced string.
    expect(row?.text('status')).toBeNull()
  })

  it('reads a checkbox and an actor without touching the columns', async () => {
    const { conn } = db({
      instances: [instance('a')],
      values: [
        valueRow('a', 'f_billable', 'a0', { valueBoolean: false }),
        valueRow('a', 'f_inspected', 'a0', { actorId: 'user_7' }),
      ],
    })

    const [row] = await readSystemRecords(conn, ORG, ctx)

    // `false` is a stored answer, not an absence.
    expect(row?.boolean('billable')).toBe(false)
    expect(row?.actor('inspected_by')).toBe('user_7')
    expect(row?.cell('inspected_by')).toMatchObject({ type: 'actor', actorId: 'user:user_7' })
    expect(row?.boolean('name')).toBeNull()
    expect(row?.actor('name')).toBeNull()
  })

  it('reads a stored NUMBER whose column is NULL as null, never as zero', async () => {
    // `rowToTypedValue` defaults a NULL `valueNumber` to `0`. The hand-written
    // reads this replaces returned `null`, and the distinction is load-bearing:
    // `readBuildMovements` refuses a reversal on a build whose movement carries
    // no frozen unit cost, rather than reversing it at nothing.
    const { conn } = db({
      instances: [instance('a')],
      values: [valueRow('a', 'f_amount', 'a0', { valueNumber: null })],
    })

    const [row] = await readSystemRecords(conn, ORG, ctx)

    expect(row?.number('amount')).toBeNull()
    // The CELL still carries the converter's own default; only the accessor differs.
    expect(row?.cell('amount')).toMatchObject({ type: 'number', value: 0 })
  })

  it('reads a stored CHECKBOX whose column is NULL as null, never as false', async () => {
    const { conn } = db({
      instances: [instance('a')],
      values: [valueRow('a', 'f_billable', 'a0', { valueBoolean: null })],
    })

    const [row] = await readSystemRecords(conn, ORG, ctx)

    // A caller defaulting with `?? true` must not have a NULL row answer for it.
    expect(row?.boolean('billable')).toBeNull()
  })

  it('keeps sortKey order on a multi-value cell', async () => {
    const { conn } = db({
      instances: [instance('a')],
      values: [
        valueRow('a', 'f_handles', 'a0', { optionId: 'shopify_payments' }),
        valueRow('a', 'f_handles', 'a1', { optionId: 'affirm' }),
        valueRow('a', 'f_handles', 'a2', { optionId: 'paypal' }),
      ],
    })

    const [row] = await readSystemRecords(conn, ORG, ctx)

    expect(
      row?.cells('handles').map((value) => (value.type === 'option' ? value.optionId : ''))
    ).toEqual(['shopify_payments', 'affirm', 'paypal'])
    // `cell` is the first stored value, which is the first by sortKey.
    expect(row?.cell('handles')).toMatchObject({ optionId: 'shopify_payments' })
  })

  it('answers nothing for an attribute the org has no field for', async () => {
    const { conn } = db({ instances: [instance('a')], values: [] })
    const missing: SystemFieldContext<Attribute> = { ...ctx, fields: { ...ctx.fields, name: null } }

    const [row] = await readSystemRecords(conn, ORG, missing)

    expect(row?.cell('name')).toBeUndefined()
    expect(row?.cells('name')).toEqual([])
    expect(row?.text('name')).toBeNull()
  })

  it('hides archived instances unless asked, and reports archivedAt when it does', async () => {
    const archived = instance('a', { archivedAt: new Date('2026-03-01') })
    const { conn, calls } = db({ instances: [archived], values: [] })

    const [row] = await readSystemRecords(conn, ORG, ctx, { includeArchived: true })

    expect(row?.archivedAt).toEqual(new Date('2026-03-01'))
    // The archived predicate is a WHERE fragment, not a second query.
    expect(calls).toHaveLength(2)
  })

  it('orders by the column asked for', async () => {
    const { conn } = db({
      instances: [
        instance('a', { createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-05-01') }),
        instance('b', { createdAt: new Date('2026-02-01'), updatedAt: new Date('2026-04-01') }),
      ],
      values: [],
    })

    expect((await readSystemRecords(conn, ORG, ctx)).map((row) => row.id)).toEqual(['a', 'b'])
    expect(
      (await readSystemRecords(conn, ORG, ctx, { orderBy: 'updatedAt' })).map((row) => row.id)
    ).toEqual(['b', 'a'])
  })

  it('issues no query at all for an empty id list', async () => {
    const { conn, calls } = db({})
    expect(await readSystemRecords(conn, ORG, ctx, { ids: [] })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('chunks past 200 ids rather than sending one unbounded IN-list', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `r-${i}`)
    const { conn, calls } = db({ instances: ids.map((id) => instance(id)), values: [] })

    await readSystemRecords(conn, ORG, ctx, { ids })

    // 2 instance chunks; the values read then covers 402 rows (each chunk
    // returned the full mock page) in 3 chunks.
    const instanceCalls = calls.filter((call) => call.table === schema.EntityInstance)
    expect(instanceCalls).toHaveLength(2)
    expect(calls.length - instanceCalls.length).toBeGreaterThan(1)
  })

  it('dedupes ids so a repeated parent does not widen the query', async () => {
    const ids = Array.from({ length: 400 }, (_, i) => `r-${i % 100}`)
    const { conn, calls } = db({ instances: [instance('r-0')], values: [] })

    await readSystemRecords(conn, ORG, ctx, { ids })

    expect(calls.filter((call) => call.table === schema.EntityInstance)).toHaveLength(1)
  })
})

describe('readSystemRecords, cells: false', () => {
  it('skips the values query entirely', async () => {
    const { conn, calls } = db({
      instances: [instance('a')],
      values: [valueRow('a', 'f_name', 'a0', { valueText: 'Stripe' })],
    })

    const rows = await readSystemRecords(conn, ORG, ctx, { cells: false })

    expect(calls).toHaveLength(1)
    expect(rows.map((row) => row.id)).toEqual(['a'])
  })

  it('answers every accessor as unset rather than throwing', async () => {
    const { conn } = db({
      instances: [instance('a')],
      values: [valueRow('a', 'f_name', 'a0', { valueText: 'Stripe' })],
    })

    const [row] = await readSystemRecords(conn, ORG, ctx, { cells: false })

    expect(row?.cell('name')).toBeUndefined()
    expect(row?.cells('name')).toEqual([])
    expect(row?.rows('name')).toEqual([])
    expect(row?.text('name')).toBeNull()
    expect(row?.number('amount')).toBeNull()
    expect(row?.boolean('billable')).toBeNull()
    expect(row?.option('status')).toBeNull()
    expect(row?.related('order')).toBeNull()
    expect(row?.date('placed_at')).toBeNull()
    expect(row?.actor('inspected_by')).toBeNull()
  })
})

describe('readSystemRecords, by parent', () => {
  it('reads the children of a set of parents through the relationship field', async () => {
    const { conn, calls } = db({
      children: [{ entityId: 'line_1' }, { entityId: 'line_2' }],
      instances: [instance('line_1'), instance('line_2')],
      values: [valueRow('line_1', 'f_name', 'a0', { valueText: 'Widget' })],
    })

    const rows = await readSystemRecords(conn, ORG, ctx, {
      by: { attribute: 'order', in: ['order_1', 'order_2'] },
    })

    // One extra query for the relation, then the same two.
    expect(calls).toHaveLength(3)
    expect(calls[0]?.table).toBe(schema.FieldValue)
    expect(rows.map((row) => row.id)).toEqual(['line_1', 'line_2'])
    expect(rows[0]?.text('name')).toBe('Widget')
  })

  it('answers nothing when no child points at any of the parents', async () => {
    const { conn, calls } = db({ children: [] })
    expect(
      await readSystemRecords(conn, ORG, ctx, { by: { attribute: 'order', in: ['o1'] } })
    ).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('answers nothing when the org has no field for the relationship', async () => {
    const { conn, calls } = db({})
    const missing: SystemFieldContext<Attribute> = {
      ...ctx,
      fields: { ...ctx.fields, order: null },
    }
    expect(
      await readSystemRecords(conn, ORG, missing, { by: { attribute: 'order', in: ['o1'] } })
    ).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('intersects `by` with `ids` rather than widening to either', async () => {
    const { conn } = db({
      children: [{ entityId: 'line_1' }, { entityId: 'line_2' }],
      instances: [instance('line_1')],
      values: [],
    })

    const rows = await readSystemRecords(conn, ORG, ctx, {
      ids: ['line_1', 'line_9'],
      by: { attribute: 'order', in: ['order_1'] },
    })

    expect(rows.map((row) => row.id)).toEqual(['line_1'])
  })

  it('chunks the parent list too', async () => {
    const parents = Array.from({ length: 401 }, (_, i) => `o-${i}`)
    const { conn, calls } = db({ children: [], instances: [], values: [] })

    await readSystemRecords(conn, ORG, ctx, { by: { attribute: 'order', in: parents } })

    expect(calls).toHaveLength(3)
  })
})

describe('inPageOrder', () => {
  it('restores the page order the reader replaced with createdAt', async () => {
    const { conn } = db({
      instances: [instance('b'), instance('a'), instance('c')],
      values: [],
    })
    const page = ['c', 'a', 'b']
    const records = await readSystemRecords(conn, ORG, ctx, { ids: page })

    expect(inPageOrder(records, page).map((record) => record.id)).toEqual(page)
  })

  it('drops an id the reader did not return', async () => {
    const { conn } = db({ instances: [instance('a')], values: [] })
    const records = await readSystemRecords(conn, ORG, ctx, { ids: ['a', 'gone'] })

    expect(inPageOrder(records, ['gone', 'a']).map((record) => record.id)).toEqual(['a'])
  })
})
