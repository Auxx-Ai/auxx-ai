// packages/lib/src/accounting/documents/lines/__tests__/module.test.ts
//
// The module end to end over an in-memory stand-in for FieldValue storage: the
// system-records reader and the crud handler are faked, `storage/field-value.ts`,
// `reads.ts` and `writes.ts` run for real. Plans/entity/domain-tables/01 §6.

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; createdAt: Date; cells: Record<string, unknown> }

const h = vi.hoisted(() => ({
  store: new Map<string, Map<string, Row>>(),
  seq: 0,
  clock: 0,
  refuseWrite: null as Error | null,
  refuseCreateAt: null as number | null,
  creates: 0,
  deletes: [] as Array<{ recordId: string; options: unknown }>,
  writes: [] as Array<{ recordId: string; fieldId: string; value: unknown }>,
  recomputeTotals: vi.fn(async (_input: unknown) => {}),
  releaseLineAllocations: vi.fn(async (_db: unknown, _org: string, _sel: unknown) => {}),
  syncInvoiceBillingProjection: vi.fn(async (_input: unknown) => {}),
  publishLinesUpdated: vi.fn(async (_org: string, _data: unknown, _opts: unknown) => {}),
}))

function table(entityType: string): Map<string, Row> {
  let rows = h.store.get(entityType)
  if (!rows) {
    rows = new Map()
    h.store.set(entityType, rows)
  }
  return rows
}

/** A relationship arrives as a `RecordId`; the fake stores the instance half. */
function stored(value: unknown): unknown {
  return typeof value === 'string' && /^[a-z_]+:.+/.test(value) ? value.split(':')[1] : value
}

vi.mock('@auxx/database', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/database')
  return { ...actual, database: {} }
})

vi.mock('../../../../resources/system-records', () => ({
  systemFields: async (_db: unknown, _org: string, entityType: string, attrs: string[]) => ({
    defId: entityType,
    fields: Object.fromEntries(attrs.map((attr) => [attr, { id: attr }])),
  }),
  readSystemRecords: async (
    _db: unknown,
    _org: string,
    ctx: { defId: string },
    options: { ids?: string[]; by?: { attribute: string; in: string[] } }
  ) => {
    const rows = [...table(ctx.defId).values()].filter((row) => {
      if (options.ids && !options.ids.includes(row.id)) return false
      if (options.by && !options.by.in.includes(row.cells[options.by.attribute] as string))
        return false
      return true
    })
    return rows.map((row) => {
      const get = (attr: string) => row.cells[attr]
      const typed = <T>(attr: string, type: string): T | null =>
        typeof get(attr) === type ? (get(attr) as T) : null
      return {
        id: row.id,
        createdAt: row.createdAt,
        text: (a: string) => typed<string>(a, 'string'),
        number: (a: string) => typed<number>(a, 'number'),
        boolean: (a: string) => typed<boolean>(a, 'boolean'),
        option: (a: string) => typed<string>(a, 'string'),
        date: (a: string) => typed<string>(a, 'string'),
        related: (a: string) => typed<string>(a, 'string'),
        cells: (a: string) =>
          Array.isArray(get(a))
            ? (get(a) as unknown[]).map((value) => ({ type: 'json', value }))
            : [],
      }
    })
  },
}))

vi.mock('../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    fieldValueService = {
      setValueWithBuiltIn: async (input: { recordId: string; fieldId: string; value: unknown }) => {
        if (h.refuseWrite) throw h.refuseWrite
        h.writes.push(input)
        const [entityType, id] = input.recordId.split(':') as [string, string]
        const row = table(entityType).get(id)
        if (row) row.cells[input.fieldId] = stored(input.value)
      },
    }
    async create(entityType: string, values: Record<string, unknown>) {
      h.creates++
      if (h.refuseCreateAt === h.creates) throw new Error('pre-create guard refused')
      const id = `${entityType}_${++h.seq}`
      const cells = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, stored(v)]))
      table(entityType).set(id, { id, createdAt: new Date(++h.clock), cells })
      return { instance: { id }, recordId: `${entityType}:${id}`, values }
    }
    async delete(recordId: string, options: unknown = {}) {
      h.deletes.push({ recordId, options })
      const [entityType, id] = recordId.split(':') as [string, string]
      table(entityType).delete(id)
    }
  },
}))

vi.mock('../../../sales/totals/totals-hooks', () => ({ recomputeTotals: h.recomputeTotals }))
vi.mock('../../../sales/billing/allocations', () => ({
  releaseLineAllocations: h.releaseLineAllocations,
}))
vi.mock('../../../sales/billing/projection', () => ({
  syncInvoiceBillingProjection: h.syncInvoiceBillingProjection,
}))
vi.mock('../realtime', () => ({ publishLinesUpdated: h.publishLinesUpdated }))

import type { Database } from '@auxx/database'
import { BadRequestError, ConflictError } from '../../../../errors'
import { LINE_DOCUMENT_TYPES, type LineDocumentType, type LinePatch } from '../client'
import { readDocumentLines, readLineParent, readLinesForTotals } from '../reads'
import { KIND_STORAGE } from '../storage/field-value'
import { createLines, deleteLines, reorderLines, updateLine, updateLines } from '../writes'

const db = {} as Database
const ORG = 'org_1'
const USER = 'user_1'

/** A writable text key per kind, for the per-kind round trip. */
const TEXT_KEY: Record<LineDocumentType, 'name' | 'description'> = {
  quote: 'name',
  order: 'name',
  invoice: 'name',
  work_order: 'name',
  credit_memo: 'name',
  purchase_order: 'description',
  vendor_bill: 'description',
  vendor_credit: 'description',
}

function seedLine(
  documentType: LineDocumentType,
  cells: Record<string, unknown>,
  id = `seed_${++h.seq}`
): string {
  const { entity } = KIND_STORAGE[documentType]
  table(entity.lineEntityType).set(id, { id, createdAt: new Date(++h.clock), cells })
  return id
}

beforeEach(() => {
  vi.clearAllMocks()
  h.store.clear()
  h.seq = 0
  h.clock = 0
  h.refuseWrite = null
  h.refuseCreateAt = null
  h.creates = 0
  h.deletes = []
  h.writes = []
  table('invoice').set('doc_1', {
    id: 'doc_1',
    createdAt: new Date(0),
    cells: { invoice_status: 'draft' },
  })
})

describe.each([
  ...LINE_DOCUMENT_TYPES,
])('%s: create → update → reorder → delete', (documentType) => {
  const ref = { documentType, documentId: 'doc_1' }
  const key = TEXT_KEY[documentType]

  it('round-trips through the module', async () => {
    const created = await createLines(db, ORG, USER, {
      ...ref,
      lines: [{ [key]: 'First', qty: 1 } as LinePatch, { [key]: 'Second', qty: 2 } as LinePatch],
    })
    expect(created.isOk()).toBe(true)
    const [a, b] = created._unsafeUnwrap()
    expect(a).toMatchObject({ documentType, documentId: 'doc_1', sortOrder: 0, [key]: 'First' })
    expect(b).toMatchObject({ sortOrder: 1, qty: 2 })

    const updated = await updateLine(db, ORG, USER, { ...ref, lineId: a!.id, patch: { qty: 5 } })
    expect(updated._unsafeUnwrap().qty).toBe(5)

    const reordered = await reorderLines(db, ORG, USER, { ...ref, orderedIds: [b!.id, a!.id] })
    expect(reordered._unsafeUnwrap().map((line) => [line.id, line.sortOrder])).toEqual([
      [b!.id, 0],
      [a!.id, 1],
    ])
    expect((await readDocumentLines(db, ORG, ref)).map((line) => line.id)).toEqual([b!.id, a!.id])

    const deleted = await deleteLines(db, ORG, USER, { ...ref, ids: [a!.id] })
    expect(deleted._unsafeUnwrap()).toEqual([a!.id])
    expect((await readDocumentLines(db, ORG, ref)).map((line) => line.id)).toEqual([b!.id])

    const recomputes = h.recomputeTotals.mock.calls.map(
      ([input]) => (input as { documentType: string }).documentType
    )
    const expected = ['quote', 'order', 'purchase_order', 'invoice'].includes(documentType)
      ? [documentType]
      : []
    expect(recomputes).toEqual(expected)
    expect(h.publishLinesUpdated).toHaveBeenLastCalledWith(
      ORG,
      { ...ref, upserted: [], deleted: [a!.id] },
      { excludeSocketId: undefined }
    )
  })
})

describe('the invoice delete arm', () => {
  const ref = { documentType: 'invoice' as const, documentId: 'doc_1' }

  it('releases allocations, deletes without post-delete hooks, recomputes and re-projects', async () => {
    const id = seedLine('invoice', { line_item_invoice: 'doc_1', line_item_name: 'Copy' })
    const result = await deleteLines(db, ORG, USER, { ...ref, ids: [id] }, { socketId: 'sock_1' })
    expect(result._unsafeUnwrap()).toEqual([id])
    expect(h.releaseLineAllocations).toHaveBeenCalledWith(db, ORG, { invoiceLineItemId: id })
    expect(h.deletes).toEqual([
      { recordId: `line_item:${id}`, options: { suppressPostDeleteHooks: true } },
    ])
    expect(h.recomputeTotals).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'invoice', documentInstanceId: 'doc_1' })
    )
    expect(h.syncInvoiceBillingProjection).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceInstanceId: 'doc_1' })
    )
    expect(h.publishLinesUpdated).toHaveBeenCalledWith(
      ORG,
      { ...ref, upserted: [], deleted: [id] },
      { excludeSocketId: 'sock_1' }
    )
  })

  it('refuses on an issued invoice and touches nothing', async () => {
    table('invoice').get('doc_1')!.cells.invoice_status = 'sent'
    const id = seedLine('invoice', { line_item_invoice: 'doc_1' })
    const error = (await deleteLines(db, ORG, USER, { ...ref, ids: [id] }))._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toContain("must be 'draft' (currently 'sent')")
    expect(h.releaseLineAllocations).not.toHaveBeenCalled()
    expect(h.deletes).toEqual([])
  })
})

describe('a line from another document', () => {
  const ref = { documentType: 'quote' as const, documentId: 'doc_1' }

  it('is refused by update, update many, reorder and delete', async () => {
    const own = seedLine('quote', { line_item_quote: 'doc_1' })
    const foreign = seedLine('quote', { line_item_quote: 'doc_2' })
    const attempts = [
      updateLine(db, ORG, USER, { ...ref, lineId: foreign, patch: { qty: 9 } }),
      updateLines(db, ORG, USER, {
        ...ref,
        updates: [
          { lineId: own, patch: { qty: 9 } },
          { lineId: foreign, patch: { qty: 9 } },
        ],
      }),
      reorderLines(db, ORG, USER, { ...ref, orderedIds: [foreign, own] }),
      deleteLines(db, ORG, USER, { ...ref, ids: [foreign] }),
    ]
    for (const result of await Promise.all(attempts)) {
      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(BadRequestError)
      expect(error.message).toContain(`Line ${foreign} is not on this quote`)
    }
    expect(h.writes).toEqual([])
    expect(h.deletes).toEqual([])
  })

  it('refuses a line of another kind under the same id space', async () => {
    const orderLine = seedLine('order', { line_item_order: 'doc_1' })
    const result = await updateLine(db, ORG, USER, { ...ref, lineId: orderLine, patch: { qty: 2 } })
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })
})

describe('a work-order source line that was invoiced', () => {
  it('reports its owning parent, the work order', async () => {
    const id = seedLine('work_order', { line_item_work_order: 'wo_1', line_item_invoice: 'inv_1' })
    expect(await readLineParent(db, ORG, id)).toEqual({
      documentType: 'work_order',
      documentId: 'wo_1',
    })
  })

  it('is the work order line, not the invoice line', async () => {
    const source = seedLine('work_order', {
      line_item_work_order: 'wo_1',
      line_item_invoice: 'inv_1',
    })
    const copy = seedLine('invoice', { line_item_invoice: 'inv_1' })
    const invoice = { documentType: 'invoice' as const, documentId: 'inv_1' }
    expect((await readDocumentLines(db, ORG, invoice)).map((line) => line.id)).toEqual([copy])
    expect(
      (await readDocumentLines(db, ORG, { documentType: 'work_order', documentId: 'wo_1' })).map(
        (line) => line.id
      )
    ).toEqual([source])
    expect((await readLinesForTotals(db, ORG, invoice)).map((row) => row.lineInstanceId)).toEqual([
      copy,
    ])
    const refused = await updateLine(db, ORG, USER, {
      ...invoice,
      lineId: source,
      patch: { qty: 2 },
    })
    expect(refused._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('reports the quote first, and an order line as the order', async () => {
    const quoteLine = seedLine('quote', { line_item_quote: 'q_1' })
    const orderLine = seedLine('order', { line_item_order: 'o_1' })
    const memoLine = seedLine('credit_memo', { credit_memo_line_credit_memo: 'cm_1' })
    expect(await readLineParent(db, ORG, quoteLine)).toEqual({
      documentType: 'quote',
      documentId: 'q_1',
    })
    expect(await readLineParent(db, ORG, orderLine)).toEqual({
      documentType: 'order',
      documentId: 'o_1',
    })
    expect(await readLineParent(db, ORG, memoLine)).toEqual({
      documentType: 'credit_memo',
      documentId: 'cm_1',
    })
    expect(await readLineParent(db, ORG, 'nope')).toBeNull()
  })
})

describe('lock parity', () => {
  it('an issued invoice refuses a qty edit with the pre-hook error, unchanged', async () => {
    const id = seedLine('invoice', { line_item_invoice: 'doc_1', line_item_qty: 1 })
    const refusal = new ConflictError(
      'Invoice INV-1 has been issued, so you cannot change the quantity. Press Edit to unlock it, ' +
        'then Save to bring its ledger entry up to date — or void it and raise a new one.'
    )
    h.refuseWrite = refusal
    const result = await updateLine(db, ORG, USER, {
      documentType: 'invoice',
      documentId: 'doc_1',
      lineId: id,
      patch: { qty: 3 },
    })
    expect(result._unsafeUnwrapErr()).toBe(refusal)
    expect(table('line_item').get(id)!.cells.line_item_qty).toBe(1)
    expect(h.publishLinesUpdated).not.toHaveBeenCalled()
  })
})

describe('patch validation', () => {
  it('refuses an engine-owned key before writing', async () => {
    const id = seedLine('quote', { line_item_quote: 'doc_1' })
    const result = await updateLine(db, ORG, USER, {
      documentType: 'quote',
      documentId: 'doc_1',
      lineId: id,
      patch: { lineTotal: 500 },
    })
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toContain('lineTotal')
    expect(h.writes).toEqual([])
  })

  it('writes the credit memo exceptions to their own attributes', async () => {
    const [memoLine] = (
      await createLines(db, ORG, USER, {
        documentType: 'credit_memo',
        documentId: 'cm_1',
        lines: [{ name: 'Refund', lineTotal: 1200, sourceLineItemId: 'li_9' }],
      })
    )._unsafeUnwrap()
    expect(table('credit_memo_line').get(memoLine!.id)!.cells).toMatchObject({
      credit_memo_line_description: 'Refund',
      credit_memo_line_subtotal: 1200,
      credit_memo_line_line_item: 'li_9',
      credit_memo_line_credit_memo: 'cm_1',
    })
    expect(memoLine).toMatchObject({ name: 'Refund', lineTotal: 1200, sourceLineItemId: 'li_9' })
  })
})

describe('createLines', () => {
  const ref = { documentType: 'quote' as const, documentId: 'doc_1' }

  it('splices new lines in after the anchor', async () => {
    const a = seedLine('quote', { line_item_quote: 'doc_1', line_item_sort_order: 0 })
    const b = seedLine('quote', { line_item_quote: 'doc_1', line_item_sort_order: 1 })
    const c = seedLine('quote', { line_item_quote: 'doc_1', line_item_sort_order: 2 })
    const [x, y] = (
      await createLines(db, ORG, USER, {
        ...ref,
        afterLineId: a,
        lines: [{ name: 'X' }, { name: 'Y' }],
      })
    )._unsafeUnwrap()
    expect((await readDocumentLines(db, ORG, ref)).map((line) => line.id)).toEqual([
      a,
      x!.id,
      y!.id,
      b,
      c,
    ])
  })

  it('deletes what it made when a later create fails', async () => {
    h.refuseCreateAt = 2
    const result = await createLines(db, ORG, USER, {
      ...ref,
      lines: [{ name: 'A' }, { name: 'B' }],
    })
    expect(result.isErr()).toBe(true)
    expect(h.deletes).toHaveLength(1)
    expect(await readDocumentLines(db, ORG, ref)).toEqual([])
    expect(h.publishLinesUpdated).not.toHaveBeenCalled()
  })

  it('stamps the visit on a work order extra, and the visit split holds', async () => {
    const wo = { documentType: 'work_order' as const, documentId: 'wo_1' }
    await createLines(db, ORG, USER, { ...wo, lines: [{ name: 'Job' }] })
    await createLines(db, ORG, USER, { ...wo, lines: [{ name: 'Extra', visitId: 'v_1' }] })
    expect((await readDocumentLines(db, ORG, wo)).map((line) => line.name)).toEqual(['Job'])
    expect(
      (await readDocumentLines(db, ORG, { ...wo, visitId: 'v_1' })).map((line) => line.name)
    ).toEqual(['Extra'])
  })
})

describe('readLinesForTotals', () => {
  it('orders newest first, as the totals engine always read them, with no cap', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) =>
      seedLine('order', {
        line_item_order: 'o_1',
        line_item_line_total: i,
        line_item_net_total: i,
      })
    )
    const rows = await readLinesForTotals(db, ORG, { documentType: 'order', documentId: 'o_1' })
    expect(rows).toHaveLength(1200)
    expect(rows[0]).toEqual({
      lineInstanceId: ids[1199],
      lineTotal: 1199,
      taxable: true,
      optional: undefined,
      optionalSelected: undefined,
      lineTax: null,
      storedNetTotal: 1199,
    })
  })

  it('reads an absent taxable as taxable, a stored false as not, and keeps the optional pair', async () => {
    seedLine('quote', { line_item_quote: 'q_1', line_item_line_total: 100 })
    seedLine('quote', {
      line_item_quote: 'q_1',
      line_item_line_total: 200,
      line_item_taxable: false,
      line_item_optional: true,
      line_item_optional_selected: false,
    })
    seedLine('quote', { line_item_quote: 'q_1' })
    const rows = await readLinesForTotals(db, ORG, { documentType: 'quote', documentId: 'q_1' })
    expect(
      rows.map(({ lineTotal, taxable, optional, optionalSelected }) => ({
        lineTotal,
        taxable,
        optional,
        optionalSelected,
      }))
    ).toEqual([
      { lineTotal: null, taxable: true, optional: undefined, optionalSelected: undefined },
      { lineTotal: 200, taxable: false, optional: true, optionalSelected: false },
      { lineTotal: 100, taxable: true, optional: undefined, optionalSelected: undefined },
    ])
  })

  it('carries the transcribed tax on a credit memo line only', async () => {
    seedLine('credit_memo', {
      credit_memo_line_credit_memo: 'cm_1',
      credit_memo_line_subtotal: 1000,
      credit_memo_line_tax_total: 80,
    })
    const [row] = await readLinesForTotals(db, ORG, {
      documentType: 'credit_memo',
      documentId: 'cm_1',
    })
    expect(row).toMatchObject({ lineTotal: 1000, lineTax: 80 })
  })
})
