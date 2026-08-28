// packages/lib/src/receiving/__tests__/receive-purchase-order.test.ts
// The multi-line receipt. `receiveStock` is mocked (it has its own suite and its
// own database dependencies) and the org cache and the one field-value read are
// faked, so nothing here needs a database — what is asserted is the CONTRACT:
// the price comes from the purchase order line and nowhere else, the whole set
// is validated before the first movement, and nothing is allocated any more.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import type { MovementRecord, ReceivePurchaseOrderLineInput } from '../types'

const h = vi.hoisted(() => ({
  receiveSpy: vi.fn(),
  /** One call per `db.select(...)`, so "one query for the whole set" is assertable. */
  selectSpy: vi.fn(),
  /** systemAttributes the org has materialised. */
  materialised: new Set<string>(),
  /** `purchase_order_line` instance id -> its stored expected unit price. */
  prices: new Map<string, number | null>(),
  /** The batched roll-up this door runs once the whole receipt is committed. */
  settleSpy: vi.fn(),
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((a) => [a, h.materialised.has(a) ? { id: `fld_${a}` } : null])
        ),
    }),
  }),
}))

vi.mock('../../field-hooks/post/purchase-order-line-rollups', () => ({
  PURCHASE_ORDER_LINE_ROLLUPS: {
    received: { targetAttr: 'purchase_order_line_quantity_received' },
  },
  recalculatePurchaseOrderLineRollups: (...args: unknown[]) => h.settleSpy(...args),
}))

vi.mock('../receive-stock', async () => {
  const { ok } = await import('neverthrow')
  return {
    receiveStock: vi.fn(async (_db, _org, _user, input) => {
      h.receiveSpy(input)
      return ok({
        movementId: `mv_${input.partId}`,
        recordId: `def_mv:mv_${input.partId}`,
        partInstanceId: input.partId,
        quantity: input.quantity,
        unitCost: input.unitCost,
        extendedCost: Math.round(input.unitCost * input.quantity),
        vendorUnitPrice: input.vendorUnitPrice ?? null,
        vendorPartId: input.vendorPartId ?? null,
        glAccount: '1310',
        occurredAt: input.occurredAt,
        purchaseOrderLineId: input.purchaseOrderLineId ?? null,
      } satisfies MovementRecord)
    }),
  }
})

import { receivePurchaseOrder } from '../receive-purchase-order'

const ORG = 'org_1'
const USER = 'user_1'

/**
 * The one read this module makes: `select({...}).from(FieldValue).where(...)`,
 * resolving to whatever `h.prices` holds.
 */
const db = {
  select: (projection: unknown) => {
    h.selectSpy(projection)
    return {
      from: () => ({
        where: async () =>
          [...h.prices.entries()].map(([entityId, valueNumber]) => ({ entityId, valueNumber })),
      }),
    }
  },
} as never

const PRICE_ATTR = 'purchase_order_line_expected_unit_price'

const line = (
  overrides: Partial<ReceivePurchaseOrderLineInput> = {}
): ReceivePurchaseOrderLineInput => ({
  partId: 'part_1',
  purchaseOrderLineId: 'pol_1',
  quantity: 1,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.settleSpy.mockResolvedValue(undefined)
  h.materialised = new Set([PRICE_ATTR])
  h.prices = new Map([
    ['pol_1', 1000],
    ['pol_2', 500],
  ])
})

async function expectErr(promise: ReturnType<typeof receivePurchaseOrder>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

/** The `ReceiveStockInput` handed to `receiveStock` for line `index`. */
function receivedInput(index: number): Record<string, unknown> {
  return h.receiveSpy.mock.calls[index]![0]
}

describe('receivePurchaseOrder — validation', () => {
  it('refuses a receipt with no lines', async () => {
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [] }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.receiveSpy).not.toHaveBeenCalled()
  })

  it('refuses a line with no part', async () => {
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ partId: '' })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('refuses a line with no purchase order line', async () => {
    // Since the price moved server-side this link is not merely provenance: it
    // is the only way this door can find out what the line cost.
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ purchaseOrderLineId: '' })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it.each([0, -1, Number.NaN])('refuses a line quantity of %s', async (quantity) => {
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity })] })
    )
    expect(error).toBeInstanceOf(BadRequestError)
  })

  it('validates the WHOLE set before writing anything', async () => {
    // A partial write is worse than a rejection: there is no undo for a ledger
    // entry, only a compensating one.
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: '' })],
      })
    )
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.receiveSpy).not.toHaveBeenCalled()
  })

  it('refuses to write before the purchase order price field is provisioned', async () => {
    h.materialised.delete(PRICE_ATTR)
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [line()] }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.receiveSpy).not.toHaveBeenCalled()
  })
})

describe('receivePurchaseOrder — the price comes from the purchase order line', () => {
  it('values the movement at the stored expected unit price of its line', async () => {
    h.prices = new Map([['pol_1', 1250]])
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 4 })] })
    expect(receivedInput(0).unitCost).toBe(1250)
    expect(receivedInput(0).vendorUnitPrice).toBe(1250)
  })

  it('🛑 ignores a price asserted by the client', async () => {
    // The defect this change exists for: receipt 3 on PO-0001 is valued at
    // $200.00 against an agreed $12.50, because somebody typed 200 into a box.
    h.prices = new Map([['pol_1', 1250]])
    await receivePurchaseOrder(db, ORG, USER, {
      // A stale client still sending the old fields. The types no longer permit
      // it; the runtime must not honour it either.
      lines: [{ ...line(), unitPrice: 20_000, weight: 12 } as ReceivePurchaseOrderLineInput],
    })
    expect(receivedInput(0).unitCost).toBe(1250)
    expect(receivedInput(0).vendorUnitPrice).toBe(1250)
  })

  it('prices each line from its OWN purchase order line', async () => {
    h.prices = new Map([
      ['pol_1', 1250],
      ['pol_2', 99],
    ])
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })
    expect(receivedInput(0).unitCost).toBe(1250)
    expect(receivedInput(1).unitCost).toBe(99)
  })

  it('reads every price in ONE query, not one per line', async () => {
    h.prices = new Map([
      ['pol_1', 100],
      ['pol_2', 200],
      ['pol_3', 300],
    ])
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line(),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' }),
        line({ partId: 'part_3', purchaseOrderLineId: 'pol_3' }),
      ],
    })
    expect(h.selectSpy).toHaveBeenCalledTimes(1)
    expect(h.receiveSpy).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['missing entirely', undefined],
    ['stored as null', null],
    ['stored as zero', 0],
    ['stored negative', -500],
  ])('refuses a line whose agreed price is %s, writing NO movements', async (_label, stored) => {
    h.prices = new Map([['pol_1', 1000]])
    if (stored !== undefined) h.prices.set('pol_2', stored as number | null)

    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    // The whole set is priced before the first movement, so the GOOD line is not
    // written either — a half-received shipment is worse than a rejected one.
    expect(h.receiveSpy).not.toHaveBeenCalled()
  })

  it('names the offending line in the refusal', async () => {
    h.prices = new Map([['pol_1', 1000]])
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      })
    )
    expect(error.message).toContain('Line 2')
    expect(error.message).toContain('pol_2')
  })

  it('does not fall back to the vendor part when the line has no price', async () => {
    // vendor_part holds standing terms that may be months newer than the order.
    // A missing agreed price is a data problem on the order, not a price to guess.
    h.prices = new Map()
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ vendorPartId: 'vp_1' })] })
    )
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.receiveSpy).not.toHaveBeenCalled()
  })
})

describe('receivePurchaseOrder — nothing is allocated at receipt', () => {
  it('capitalises nothing onto the unit cost: landed == agreed', async () => {
    // The old behaviour spread the ORDER's shipping across every receipt, so the
    // same $40.00 of freight was capitalised once per delivery. Freight is the
    // bill's number now (section 4.2).
    h.prices = new Map([['pol_1', 1000]])
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 10 })] })
    expect(receivedInput(0).unitCost).toBe(1000)
  })

  it('values two receipts of the same line identically', async () => {
    // The double-count in the plan (section 1.1) is exactly this asymmetry: four
    // receipts of one line, three of them carrying the whole freight charge.
    h.prices = new Map([['pol_1', 1250]])
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 99_997 })] })
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ quantity: 1 })] })
    expect(receivedInput(0).unitCost).toBe(1250)
    expect(receivedInput(1).unitCost).toBe(1250)
  })
})

describe('receivePurchaseOrder — one movement per line', () => {
  it('writes a movement for every line, each linked to its purchase order line', async () => {
    const result = await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'part_1', purchaseOrderLineId: 'pol_1' }),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2', quantity: 4 }),
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(2)
    expect(receivedInput(0).purchaseOrderLineId).toBe('pol_1')
    expect(receivedInput(1).purchaseOrderLineId).toBe('pol_2')
  })

  it('stamps one shared accounting date across every line', async () => {
    const occurredAt = new Date('2026-02-11T00:00:00.000Z')
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      occurredAt,
    })
    expect(receivedInput(0).occurredAt).toBe(occurredAt)
    expect(receivedInput(1).occurredAt).toBe(occurredAt)
  })

  it('carries the reference and reason onto every movement', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      reference: 'PS-4471',
      reason: 'Split delivery',
    })
    expect(receivedInput(1).reference).toBe('PS-4471')
    expect(receivedInput(1).reason).toBe('Split delivery')
  })

  it('passes the supplier part through when the line names one', async () => {
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ vendorPartId: 'vp_1' })] })
    expect(receivedInput(0).vendorPartId).toBe('vp_1')
  })
})

describe('receivePurchaseOrder — failure propagation', () => {
  it('surfaces a per-line failure with its own status, not as a generic 500', async () => {
    const { receiveStock } = await import('../receive-stock')
    const { err } = await import('neverthrow')
    vi.mocked(receiveStock).mockResolvedValueOnce(
      err(new UnprocessableEntityError('Refusing to write a receipt at zero cost.'))
    )
    const error = await expectErr(receivePurchaseOrder(db, ORG, USER, { lines: [line()] }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
  })

  it('stops at the first failing line rather than pressing on', async () => {
    const { receiveStock } = await import('../receive-stock')
    const { err } = await import('neverthrow')
    vi.mocked(receiveStock).mockResolvedValueOnce(err(new UnprocessableEntityError('nope')))
    await expectErr(
      receivePurchaseOrder(db, ORG, USER, {
        lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
      })
    )
    expect(h.receiveSpy).toHaveBeenCalledTimes(0)
  })
})

describe('receivePurchaseOrder — the roll-up is settled once, not once per line', () => {
  it('🛑 rolls the WHOLE line set up in one call after the last movement', async () => {
    // The amplifier this exists to remove: `stock_movement` create fires a
    // lifecycle rule per row, and that rule derives the entire purchase order.
    // Ten lines meant ten identical derivations. One batched call knows the
    // whole set and does it once.
    h.prices = new Map([
      ['pol_1', 100],
      ['pol_2', 200],
    ])
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })

    expect(h.settleSpy).toHaveBeenCalledTimes(1)
    expect(h.settleSpy).toHaveBeenCalledWith(
      ORG,
      ['pol_1', 'pol_2'],
      expect.objectContaining({ targetAttr: 'purchase_order_line_quantity_received' })
    )
  })

  it('settles AFTER every movement, never between them', async () => {
    const order: string[] = []
    h.receiveSpy.mockImplementation(() => order.push('movement'))
    h.settleSpy.mockImplementation(async () => {
      order.push('settle')
    })
    h.prices = new Map([
      ['pol_1', 100],
      ['pol_2', 200],
    ])

    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line(), line({ partId: 'part_2', purchaseOrderLineId: 'pol_2' })],
    })

    expect(order).toEqual(['movement', 'movement', 'settle'])
  })

  it('does not settle when the receipt was refused before writing anything', async () => {
    h.prices = new Map()
    await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })
    expect(h.settleSpy).not.toHaveBeenCalled()
  })

  it('🛑 still reports the receipt as written when the roll-up fails', async () => {
    // The movements are the primary fact and are already committed. Throwing
    // here would report a receipt that happened as a receipt that failed — and
    // the per-movement lifecycle rules are the fallback, so the quantity still
    // lands.
    h.settleSpy.mockRejectedValue(new Error('roll-up exploded'))

    const result = await receivePurchaseOrder(db, ORG, USER, { lines: [line()] })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(1)
  })
})
