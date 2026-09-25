// packages/lib/src/mrp/__tests__/actions/draft-purchase-orders.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import type { ActionItem } from '../../actions/shared'

interface VendorPartRow {
  part: string
  contact: string | null
  leadTime: number | null
  price: number | null
}

const h = vi.hoisted(() => ({
  items: new Map<string, ActionItem>(),
  vendorParts: new Map<string, VendorPartRow>(),
  poCalls: [] as { header: Record<string, unknown>; lines: Record<string, unknown>[] }[],
  failVendor: null as string | null,
  runArgs: [] as (string | undefined)[],
}))

vi.mock('../../../accounting/ledger/setup/book-time-zone', () => ({
  readBookTimeZoneOrUtc: async () => 'UTC',
  todayInBookTimeZone: async () => new Date().toISOString().slice(0, 10),
}))
vi.mock('../../actions/shared', async (importActual) => ({
  ...(await importActual<typeof import('../../actions/shared')>()),
  resolveActionRun: vi.fn(async (_db: unknown, _org: string, runId?: string) => {
    h.runArgs.push(runId)
    return { id: runId ?? 'run_latest', asOf: new Date('2026-09-20T00:00:00Z') }
  }),
  readActionItems: vi.fn(async (_db: unknown, _org: string, _run: string, ids: string[]) => {
    return new Map(ids.flatMap((id) => (h.items.has(id) ? [[id, h.items.get(id)!]] : [])))
  }),
}))

vi.mock('../../../resources/system-records', () => ({
  requireSystemFields: vi.fn(async () => ({ defId: 'def_vp', fields: {} })),
  systemDefId: vi.fn(async (_db: unknown, _org: string, type: string) => `def_${type}`),
  readSystemRecords: vi.fn(
    async (_db: unknown, _org: string, _ctx: unknown, opts: { ids: string[] }) =>
      opts.ids.flatMap((id) => {
        const row = h.vendorParts.get(id)
        if (!row) return []
        return [
          {
            id,
            recordId: `def_vp:${id}`,
            related: (a: string) => (a === 'vendor_part_part' ? row.part : row.contact),
            number: (a: string) => (a === 'vendor_part_lead_time' ? row.leadTime : row.price),
          },
        ]
      })
  ),
}))

vi.mock('../../../accounting/purchasing/create-purchase-order', () => ({
  createPurchaseOrder: vi.fn(
    async (
      _db: unknown,
      _org: string,
      _user: string,
      input: { header: Record<string, unknown>; lines: Record<string, unknown>[] }
    ) => {
      h.poCalls.push(input)
      if (input.header.purchase_order_vendor === h.failVendor) {
        return err(new UnprocessableEntityError('Supplier is archived'))
      }
      const n = h.poCalls.length
      return ok({ purchaseOrderId: `po_${n}`, number: `PO-${n}`, lineIds: [] })
    }
  ),
}))

import { draftPurchaseOrders } from '../../actions/draft-purchase-orders'

// The Nth createPurchaseOrder call, failing the test when it was never made.
function po(index: number) {
  const call = h.poCalls[index]
  if (!call) throw new Error(`no createPurchaseOrder call #${index}`)
  return call
}

function purchase(partId: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    partId,
    suggestionKind: 'purchase',
    supplyType: 'bought',
    suggestedQty: 10,
    suggestedVendorPartId: `vp_${partId}`,
    suggestedSupplierId: 'acme',
    ...over,
  }
}

function seed(item: ActionItem, vp: Partial<VendorPartRow> = {}) {
  h.items.set(item.partId, item)
  if (item.suggestedVendorPartId) {
    h.vendorParts.set(item.suggestedVendorPartId, {
      part: item.partId,
      contact: item.suggestedSupplierId,
      leadTime: null,
      price: null,
      ...vp,
    })
  }
}

const draft = (
  items: { partId: string; quantity?: number; vendorPartId?: string }[],
  runId?: string
) => draftPurchaseOrders({} as never, 'org_1', 'user_1', { runId, items })

beforeEach(() => {
  h.items.clear()
  h.vendorParts.clear()
  h.poCalls.length = 0
  h.failVendor = null
  h.runArgs.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))
})

describe('draftPurchaseOrders', () => {
  it('groups by supplier into one PO each, with lines, expected date, price and memo', async () => {
    seed(purchase('p1'), { leadTime: 14, price: 250 })
    seed(purchase('p2', { suggestedQty: 5 }), { leadTime: 30 })
    seed(purchase('p3', { suggestedSupplierId: 'bolt' }))

    const result = (
      await draft([{ partId: 'p1' }, { partId: 'p2' }, { partId: 'p3' }])
    )._unsafeUnwrap()

    expect(h.runArgs).toEqual([undefined])
    expect(result.runId).toBe('run_latest')
    expect(result.refused).toEqual([])
    expect(result.created).toEqual([
      { supplierId: 'acme', purchaseOrderId: 'po_1', number: 'PO-1', partIds: ['p1', 'p2'] },
      { supplierId: 'bolt', purchaseOrderId: 'po_2', number: 'PO-2', partIds: ['p3'] },
    ])
    expect(po(0).header).toEqual({
      purchase_order_vendor: 'def_company:acme',
      purchase_order_expected_at: '2026-10-24',
      purchase_order_notes:
        '<p>Drafted from MRP run run_latest (as of 2026-09-20). Parts: p1, p2</p>',
    })
    expect(po(0).lines).toEqual([
      {
        purchase_order_line_part: 'def_part:p1',
        purchase_order_line_vendor_part: 'def_vp:vp_p1',
        purchase_order_line_quantity_ordered: 10,
        purchase_order_line_expected_unit_price: 250,
      },
      {
        purchase_order_line_part: 'def_part:p2',
        purchase_order_line_vendor_part: 'def_vp:vp_p2',
        purchase_order_line_quantity_ordered: 5,
        purchase_order_line_expected_unit_price: null,
      },
    ])
    expect(po(1).header.purchase_order_expected_at).toBeNull()
  })

  it('passes an explicit run id through', async () => {
    seed(purchase('p1'))
    const result = (await draft([{ partId: 'p1' }], 'run_7'))._unsafeUnwrap()
    expect(h.runArgs).toEqual(['run_7'])
    expect(result.runId).toBe('run_7')
  })

  it('an overridden quantity and vendor part win, and the supplier follows the vendor part', async () => {
    seed(purchase('p1'))
    h.vendorParts.set('vp_other', { part: 'p1', contact: 'bolt', leadTime: null, price: 99 })

    const result = (
      await draft([{ partId: 'p1', quantity: 129, vendorPartId: 'vp_other' }])
    )._unsafeUnwrap()

    expect(result.created).toEqual([
      { supplierId: 'bolt', purchaseOrderId: 'po_1', number: 'PO-1', partIds: ['p1'] },
    ])
    expect(po(0).lines.at(0)).toMatchObject({
      purchase_order_line_vendor_part: 'def_vp:vp_other',
      purchase_order_line_quantity_ordered: 129,
      purchase_order_line_expected_unit_price: 99,
    })
  })

  it('refuses each unusable part by name and drafts the rest', async () => {
    seed(purchase('ok'))
    seed(purchase('made', { suggestionKind: 'build' }))
    seed(purchase('none', { suggestionKind: null }))
    seed(purchase('novp', { suggestedVendorPartId: null }))
    seed(purchase('zero', { suggestedQty: 0 }))
    seed(purchase('neg'))
    seed(purchase('gone'))
    h.vendorParts.delete('vp_gone')
    seed(purchase('wrong'))
    h.vendorParts.set('vp_wrong', {
      part: 'someone_else',
      contact: 'acme',
      leadTime: null,
      price: null,
    })
    seed(purchase('orphan', { suggestedSupplierId: null }), { contact: null })

    const result = (
      await draft([
        { partId: 'ok' },
        { partId: 'missing' },
        { partId: 'made' },
        { partId: 'none' },
        { partId: 'novp' },
        { partId: 'zero' },
        { partId: 'neg', quantity: -3 },
        { partId: 'gone' },
        { partId: 'wrong' },
        { partId: 'orphan' },
      ])
    )._unsafeUnwrap()

    expect(result.created.map((c) => c.partIds)).toEqual([['ok']])
    expect(result.refused).toEqual([
      { partId: 'missing', reason: 'Not planned in this MRP run' },
      { partId: 'made', reason: 'The run does not suggest a purchase' },
      { partId: 'none', reason: 'The run does not suggest a purchase' },
      { partId: 'novp', reason: 'No vendor part to order from' },
      { partId: 'zero', reason: 'No quantity to order' },
      { partId: 'neg', reason: 'No quantity to order' },
      { partId: 'gone', reason: 'The vendor part no longer exists' },
      { partId: 'wrong', reason: 'The vendor part belongs to a different part' },
      { partId: 'orphan', reason: 'The vendor part has no supplier' },
    ])
  })

  it('an explicit quantity drafts a bought part the run did not suggest', async () => {
    seed(purchase('p1', { suggestionKind: null, suggestedQty: null }))

    const result = (await draft([{ partId: 'p1', quantity: 40 }]))._unsafeUnwrap()

    expect(result.refused).toEqual([])
    expect(result.created.map((c) => c.partIds)).toEqual([['p1']])
    expect(po(0).lines.at(0)).toMatchObject({ purchase_order_line_quantity_ordered: 40 })
  })

  it('an explicit quantity with a vendor part drafts a part that is not classified bought', async () => {
    seed(purchase('p1', { suggestionKind: null, supplyType: 'unclassified' }))
    h.vendorParts.set('vp_other', { part: 'p1', contact: 'bolt', leadTime: null, price: null })

    const result = (
      await draft([{ partId: 'p1', quantity: 129, vendorPartId: 'vp_other' }])
    )._unsafeUnwrap()

    expect(result.refused).toEqual([])
    expect(result.created).toEqual([
      { supplierId: 'bolt', purchaseOrderId: 'po_1', number: 'PO-1', partIds: ['p1'] },
    ])
  })

  it('an explicit quantity still needs a bought part or a vendor part', async () => {
    seed(
      purchase('p1', { suggestionKind: 'build', supplyType: 'made', suggestedVendorPartId: null })
    )

    const result = (await draft([{ partId: 'p1', quantity: 5 }]))._unsafeUnwrap()

    expect(result.created).toEqual([])
    expect(result.refused).toEqual([
      { partId: 'p1', reason: 'The run does not suggest a purchase' },
    ])
  })

  it('a supplier whose PO is refused does not lose the other suppliers', async () => {
    seed(purchase('a1'))
    seed(purchase('a2'))
    seed(purchase('b1', { suggestedSupplierId: 'bolt' }))
    h.failVendor = 'def_company:acme'

    const result = (
      await draft([{ partId: 'a1' }, { partId: 'b1' }, { partId: 'a2' }])
    )._unsafeUnwrap()

    expect(result.created).toEqual([
      { supplierId: 'bolt', purchaseOrderId: 'po_2', number: 'PO-2', partIds: ['b1'] },
    ])
    expect(result.refused).toEqual([
      { partId: 'a1', reason: 'Supplier is archived' },
      { partId: 'a2', reason: 'Supplier is archived' },
    ])
  })

  it('drafts a part selected twice once', async () => {
    seed(purchase('p1'))
    const result = (await draft([{ partId: 'p1', quantity: 3 }, { partId: 'p1' }]))._unsafeUnwrap()
    expect(po(0).lines).toHaveLength(1)
    expect(po(0).lines.at(0)?.purchase_order_line_quantity_ordered).toBe(3)
    expect(result.created).toHaveLength(1)
  })
})
