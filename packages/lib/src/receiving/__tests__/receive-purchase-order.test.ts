// packages/lib/src/receiving/__tests__/receive-purchase-order.test.ts
// The multi-line receipt. `receiveStock` is mocked (it has its own suite and its
// own database dependencies); the allocation is the REAL `allocateLandedCost`,
// because the thing worth asserting here is that the allocated unit cost is what
// actually reaches the movement.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import type { MovementRecord, ReceivePurchaseOrderLineInput } from '../types'

const h = vi.hoisted(() => ({
  receiveSpy: vi.fn(),
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
const db = {} as never

const line = (
  overrides: Partial<ReceivePurchaseOrderLineInput> = {}
): ReceivePurchaseOrderLineInput => ({
  partId: 'part_1',
  purchaseOrderLineId: 'pol_1',
  quantity: 1,
  unitPrice: 1000,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
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
    // An allocated cost is only defensible if the line it was allocated across
    // can be pointed at.
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

  it('refuses a line with a non-finite unit price', async () => {
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line({ unitPrice: Number.NaN })] })
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
})

describe('receivePurchaseOrder — one movement per line', () => {
  it('writes a movement for every line, each linked to its purchase order line', async () => {
    const result = await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'part_1', purchaseOrderLineId: 'pol_1' }),
        line({ partId: 'part_2', purchaseOrderLineId: 'pol_2', unitPrice: 500, quantity: 4 }),
      ],
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toHaveLength(2)
    expect(receivedInput(0).purchaseOrderLineId).toBe('pol_1')
    expect(receivedInput(1).purchaseOrderLineId).toBe('pol_2')
  })

  it('freezes the agreed buy price as the vendor unit price', async () => {
    // The allocated cost is what the stock is VALUED at; vendorUnitPrice is what
    // the vendor charged, and the three-way match compares the bill against it.
    await receivePurchaseOrder(db, ORG, USER, { lines: [line({ unitPrice: 999.6 })] })
    expect(receivedInput(0).vendorUnitPrice).toBe(1000)
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

describe('receivePurchaseOrder — the allocated unit cost', () => {
  it('capitalises freight into the unit cost, not just the header', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, unitPrice: 1000 })],
      shipping: 5000,
    })
    // One line absorbs all of it: (10000 + 5000) / 10.
    expect(receivedInput(0).unitCost).toBe(1500)
  })

  it('reproduces the worked example: a $1 line absorbing value-weighted freight', async () => {
    // Costing plan section 4.2, purchase HZRA2W: $1,000 and $1 lines, one unit
    // each, $10,000 shipping. The $1 line lands at 1 + 10000 x (1/1001).
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'part_big', purchaseOrderLineId: 'pol_big', unitPrice: 100000 }),
        line({ partId: 'part_small', purchaseOrderLineId: 'pol_small', unitPrice: 100 }),
      ],
      shipping: 1000000,
      basis: 'value',
    })
    expect(receivedInput(1).unitCost).toBe(1099)
  })

  it('defaults the basis to value', async () => {
    const lines = [
      line({ partId: 'a', purchaseOrderLineId: 'pol_a', unitPrice: 100000 }),
      line({ partId: 'b', purchaseOrderLineId: 'pol_b', unitPrice: 100 }),
    ]
    await receivePurchaseOrder(db, ORG, USER, { lines, shipping: 1000000 })
    const defaulted = receivedInput(1).unitCost
    h.receiveSpy.mockClear()
    await receivePurchaseOrder(db, ORG, USER, { lines, shipping: 1000000, basis: 'value' })
    expect(receivedInput(1).unitCost).toBe(defaulted)
  })

  it('spreads by quantity when asked, so a cheap heavy line carries its share', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [
        line({ partId: 'a', purchaseOrderLineId: 'pol_a', unitPrice: 100000, quantity: 1 }),
        line({ partId: 'b', purchaseOrderLineId: 'pol_b', unitPrice: 100, quantity: 1 }),
      ],
      shipping: 1000000,
      basis: 'quantity',
    })
    // Equal quantities, so an equal split: 500000 each.
    expect(receivedInput(0).unitCost).toBe(600000)
    expect(receivedInput(1).unitCost).toBe(500100)
  })

  it('capitalises tax by default and excludes it when it is recoverable', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, unitPrice: 1000 })],
      tax: 1000,
    })
    expect(receivedInput(0).unitCost).toBe(1100)

    h.receiveSpy.mockClear()
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, unitPrice: 1000 })],
      tax: 1000,
      taxRecoverable: true,
    })
    // Reclaimable input tax is a receivable from the tax authority, not part of
    // what the goods cost.
    expect(receivedInput(0).unitCost).toBe(1000)
  })

  it('subtracts a header discount from what is capitalised', async () => {
    await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ quantity: 10, unitPrice: 1000 })],
      shipping: 5000,
      discount: 2000,
    })
    expect(receivedInput(0).unitCost).toBe(1300)
  })

  it('rounds the line total before allocating, so a fractional price cannot reach the math', async () => {
    // allocateLandedCost rejects non-integer money amounts outright; a receipt
    // keyed at 999.6 must still be allocatable.
    const result = await receivePurchaseOrder(db, ORG, USER, {
      lines: [line({ unitPrice: 999.6, quantity: 3 })],
      shipping: 300,
    })
    expect(result.isOk()).toBe(true)
  })
})

describe('receivePurchaseOrder — failure propagation', () => {
  it('surfaces a per-line failure with its own status, not as a generic 500', async () => {
    const { receiveStock } = await import('../receive-stock')
    const { err } = await import('neverthrow')
    vi.mocked(receiveStock).mockResolvedValueOnce(
      err(new UnprocessableEntityError('Refusing to write a receipt at zero cost.'))
    )
    const error = await expectErr(
      receivePurchaseOrder(db, ORG, USER, { lines: [line()], shipping: 0 })
    )
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
