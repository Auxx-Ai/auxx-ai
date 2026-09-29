// packages/lib/src/inventory/movements/__tests__/reverse-movement.test.ts
// The correction path, with the table read and the write seam mocked. What is asserted is the
// CONTRACT: the quantity is negated, the ORIGINAL's frozen unit cost is carried verbatim, every
// link is copied, and a reversal is never itself reversed. A second reversal of one movement is
// refused by the unique index (see write-movements.int.test.ts); here, by the seam's ConflictError.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../../errors'
import { computeExtendedCost } from '../client'
import type { StockMovementRow } from '../reads'
import type { StockMovementInput } from '../types'

const h = vi.hoisted(() => ({
  original: undefined as Record<string, unknown> | undefined,
  writeSpy: vi.fn(),
  settleSpy: vi.fn(async () => {}),
  /** When set, the seam refuses the write with it. */
  writeError: null as Error | null,
}))

vi.mock('../reads', () => ({
  readMovementById: async () => h.original,
}))

vi.mock('../write-movements', () => ({
  writeStockMovements: async (ctx: unknown, inputs: StockMovementInput[]) => {
    h.writeSpy(ctx, inputs)
    if (h.writeError) return err(h.writeError)
    const input = inputs[0]!
    return ok({
      records: [
        {
          id: 'mv_rev',
          partInstanceId: input.partInstanceId,
          quantity: input.quantity,
          unitCost: input.unitCost,
          extendedCost:
            input.unitCost == null ? null : computeExtendedCost(input.unitCost, input.quantity),
          glRole: input.glRole ?? null,
          occurredAt: input.occurredAt,
        },
      ],
      touched: {
        partIds: [input.partInstanceId],
        purchaseOrderLineIds: [],
        fulfillmentLineIds: [],
        buildIds: [],
      },
    })
  },
  settleStockMovements: h.settleSpy,
}))

// The posting seam has its own test; this file is about the movements.
vi.mock('../../../accounting/ledger/post/post-inventory-movement', () => ({
  reversePostingForMovement: async () => null,
  linkMovementsToPosting: async () => undefined,
}))

import { reverseMovement } from '../reverse-movement'

const ORG = 'org_1'
const USER = 'user_1'
const MOVEMENT = 'mv_1'
const db = {} as never

/** A fully costed `receive` of 10 units at 4443c against `pol_1`, as `receiveStock` writes it. */
function originalReceipt(over: Partial<StockMovementRow> = {}): Record<string, unknown> {
  return {
    id: MOVEMENT,
    organizationId: ORG,
    partId: 'part_1',
    type: 'receive',
    quantity: 10,
    costBasis: 'actual',
    unitCostMinor: 4443,
    extendedCostMinor: 44430,
    glRole: 'inventory_raw_materials',
    vendorUnitPriceMinor: 4133,
    vendorPartId: 'vp_1',
    purchaseOrderLineId: 'pol_1',
    reversesMovementId: null,
    buildId: null,
    fulfillmentLineId: null,
    parentMovementId: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.original = originalReceipt()
  h.writeError = null
})

async function expectErr(promise: ReturnType<typeof reverseMovement>) {
  const result = await promise
  expect(result.isErr()).toBe(true)
  return result._unsafeUnwrapErr()
}

async function reverseAndRead(
  input: Parameters<typeof reverseMovement>[3] = { movementId: MOVEMENT }
): Promise<StockMovementInput> {
  const result = await reverseMovement(db, ORG, USER, input)
  expect(result.isOk()).toBe(true)
  expect(h.writeSpy).toHaveBeenCalledTimes(1)
  const inputs = h.writeSpy.mock.calls[0]![1] as StockMovementInput[]
  expect(inputs).toHaveLength(1)
  return inputs[0]!
}

describe('reverseMovement — the row it writes', () => {
  it('negates the original quantity', async () => {
    expect((await reverseAndRead()).quantity).toBe(-10)
  })

  it('🛑 carries the ORIGINAL frozen unit cost, never a fresh one', async () => {
    expect((await reverseAndRead()).unitCost).toBe(4443)
  })

  it('leaves the extended cost to the seam, from the frozen unit cost', async () => {
    const input = await reverseAndRead()
    expect(input.extendedCost).toBeUndefined()
  })

  it('points reversesMovementId at the row it undoes and copies every link', async () => {
    h.original = originalReceipt({
      buildId: 'build_1',
      fulfillmentLineId: 'fl_1',
      parentMovementId: 'mv_parent',
    })
    expect((await reverseAndRead()).links).toEqual({
      reversesMovementId: MOVEMENT,
      vendorPartId: 'vp_1',
      purchaseOrderLineId: 'pol_1',
      buildId: 'build_1',
      fulfillmentLineId: 'fl_1',
      parentMovementId: 'mv_parent',
    })
  })

  it('omits the links the original did not carry', async () => {
    h.original = originalReceipt({ vendorPartId: null, purchaseOrderLineId: null })
    expect((await reverseAndRead()).links).toEqual({ reversesMovementId: MOVEMENT })
  })

  it("copies the role, the vendor price and the part, and the original's cost basis", async () => {
    const input = await reverseAndRead()
    expect(input).toMatchObject({
      partInstanceId: 'part_1',
      glRole: 'inventory_raw_materials',
      vendorUnitPrice: 4133,
      costBasis: 'actual',
    })
  })

  it('NEVER sets adjustSubparts', async () => {
    expect((await reverseAndRead()).adjustSubparts).toBeUndefined()
  })

  it('stamps the reason when one is given', async () => {
    expect((await reverseAndRead({ movementId: MOVEMENT, reason: 'Keyed twice' })).reason).toBe(
      'Keyed twice'
    )
  })

  it('stamps the accounting date as now', async () => {
    const before = Date.now()
    const stamped = (await reverseAndRead()).occurredAt.getTime()
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Date.now())
  })

  it('returns exactly what it stored, and settles the touched parts', async () => {
    const result = await reverseMovement(db, ORG, USER, { movementId: MOVEMENT })
    expect(result._unsafeUnwrap()).toMatchObject({
      id: 'mv_rev',
      partInstanceId: 'part_1',
      quantity: -10,
      unitCost: 4443,
      extendedCost: -44430,
      vendorUnitPrice: 4133,
      vendorPartId: 'vp_1',
      glRole: 'inventory_raw_materials',
      purchaseOrderLineId: 'pol_1',
    })
    expect(h.settleSpy).toHaveBeenCalledWith(ORG, expect.objectContaining({ partIds: ['part_1'] }))
  })
})

describe('reverseMovement — the type it writes', () => {
  it.each([
    ['receive', 'return_out'],
    ['ship', 'return_in'],
    ['sale', 'return_in'],
    ['return_out', 'return_in'],
    ['return_in', 'return_out'],
  ])('mirrors a %s as a %s', async (original, expected) => {
    h.original = originalReceipt({ type: original as StockMovementRow['type'] })
    expect((await reverseAndRead()).type).toBe(expected)
  })

  it.each([
    'adjust',
    'scrap',
    'initial',
    'build_consume',
    'build_produce',
  ])('labels the undo of a %s as an adjust rather than inventing an event', async (original) => {
    h.original = originalReceipt({ type: original as StockMovementRow['type'] })
    expect((await reverseAndRead()).type).toBe('adjust')
  })
})

describe('reverseMovement — the refusals', () => {
  it('🛑 maps the unique-index refusal of a second reversal to its ConflictError', async () => {
    h.writeError = new ConflictError('This movement has already been reversed')
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.message).toMatch(/decrement the received quantity twice/)
    expect(h.settleSpy).not.toHaveBeenCalled()
  })

  it('refuses to reverse a reversal', async () => {
    h.original = originalReceipt({ reversesMovementId: 'mv_original' })
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(BadRequestError)
    expect(h.writeSpy).not.toHaveBeenCalled()
  })

  it('fails with NotFound when the movement does not exist in this org', async () => {
    h.original = undefined
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: 'mv_missing' }))
    expect(error).toBeInstanceOf(NotFoundError)
    expect(h.writeSpy).not.toHaveBeenCalled()
  })

  it('refuses a pre-regime row with no cost and no basis - nothing will ever price it', async () => {
    h.original = originalReceipt({ unitCostMinor: null, extendedCostMinor: null, costBasis: null })
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toMatch(/not pending a price/)
    expect(h.writeSpy).not.toHaveBeenCalled()
  })

  // 111 Q18: a pending row reverses into a pending row; both are filled when the standard lands.
  it('reverses a PENDING row into a pending row - negated quantity, same part, no cost', async () => {
    h.original = originalReceipt({
      costBasis: 'pending',
      unitCostMinor: null,
      extendedCostMinor: null,
    })
    expect(await reverseAndRead()).toMatchObject({
      partInstanceId: 'part_1',
      quantity: -10,
      unitCost: null,
      costBasis: 'pending',
      glRole: 'inventory_raw_materials',
      links: expect.objectContaining({ reversesMovementId: MOVEMENT }),
    })
  })

  it('refuses a movement carrying a cost but no GL role', async () => {
    h.original = originalReceipt({ glRole: null })
    const error = await expectErr(reverseMovement(db, ORG, USER, { movementId: MOVEMENT }))
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(h.writeSpy).not.toHaveBeenCalled()
  })
})
