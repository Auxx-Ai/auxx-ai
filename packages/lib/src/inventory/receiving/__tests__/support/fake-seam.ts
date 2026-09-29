// packages/lib/src/inventory/receiving/__tests__/support/fake-seam.ts
// An in-memory `writeStockMovements` / `settleStockMovements` pair for unit tests: rows are built
// by the real `toStockMovementRow`, so a test asserts on the columns the table would receive.

import type { CreateStockMovementInput } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { vi } from 'vitest'
import { toStockMovementRow } from '../../../movements/row'
import type {
  StockMovementInput,
  StockMovementsCtx,
  StockMovementTouched,
} from '../../../movements/types'

/** The shared fake; `reset()` it in `beforeEach`. Ids run `mv_1`, `mv_2`, … per test. */
export const fakeSeam = {
  rows: [] as CreateStockMovementInput[],
  calls: [] as StockMovementInput[][],
  settle: vi.fn(async (_org: string, _touched: StockMovementTouched) => {}),
  /** Runs before every write; throw from it to model a refused write. */
  onWrite: null as ((inputs: StockMovementInput[]) => void) | null,
  reset() {
    this.rows = []
    this.calls = []
    this.onWrite = null
    this.settle.mockReset()
  },
  async write(ctx: StockMovementsCtx, inputs: StockMovementInput[]) {
    fakeSeam.calls.push(inputs)
    try {
      fakeSeam.onWrite?.(inputs)
      const base = fakeSeam.rows.length
      const rows = inputs.map((input, i) =>
        toStockMovementRow(
          {
            id: `mv_${base + i + 1}`,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            createdAt: new Date(),
          },
          input
        )
      )
      fakeSeam.rows.push(...rows)
      const distinct = (values: Array<string | null | undefined>) => [
        ...new Set(values.filter((v): v is string => !!v)),
      ]
      return ok({
        records: rows.map((row, i) => ({
          id: row.id!,
          partInstanceId: row.partId,
          quantity: row.quantity,
          unitCost: inputs[i]!.unitCost,
          extendedCost: row.extendedCostMinor ?? null,
          glRole: row.glRole ?? null,
          occurredAt: inputs[i]!.occurredAt,
        })),
        touched: {
          partIds: distinct(rows.map((row) => row.partId)),
          purchaseOrderLineIds: distinct(rows.map((row) => row.purchaseOrderLineId)),
          fulfillmentLineIds: distinct(rows.map((row) => row.fulfillmentLineId)),
          buildIds: distinct(rows.map((row) => row.buildId)),
        },
      })
    } catch (error) {
      return err(error as Error)
    }
  },
  /** The single row a one-movement write produced. */
  only(): CreateStockMovementInput {
    if (fakeSeam.rows.length !== 1) {
      throw new Error(`expected exactly one movement, got ${fakeSeam.rows.length}`)
    }
    return fakeSeam.rows[0]!
  },
}

/** `vi.mock('<path to inventory/movements>', movementsMock)` */
export async function movementsMock(importOriginal: () => Promise<unknown>) {
  return {
    ...((await importOriginal()) as Record<string, unknown>),
    writeStockMovements: fakeSeam.write,
    settleStockMovements: fakeSeam.settle,
  }
}
