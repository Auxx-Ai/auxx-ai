// packages/lib/src/money/billing-allocation-math.ts

import { BadRequestError } from '../errors'

export interface RemainingSourceAmount {
  sourceLineItemId: string
  amount: number
}

export interface ProportionalSourceAllocation {
  sourceLineItemId: string
  amount: number
}

/**
 * Allocate integer cents proportionally over remaining source-line value.
 * Floors every share, then puts the cent remainder on the largest remaining line.
 */
export function allocateProportionally(
  sources: readonly RemainingSourceAmount[],
  requestedAmount: number
): ProportionalSourceAllocation[] {
  if (!Number.isInteger(requestedAmount) || requestedAmount <= 0) {
    throw new BadRequestError('Invoice amount must be a positive integer number of cents')
  }
  const available = sources.reduce((sum, source) => sum + source.amount, 0)
  if (sources.some((source) => !Number.isInteger(source.amount) || source.amount < 0)) {
    throw new BadRequestError('Source-line remaining amounts must be non-negative integer cents')
  }
  if (requestedAmount > available) {
    throw new BadRequestError('Invoice amount exceeds the remaining contract value')
  }
  if (available === 0) throw new BadRequestError('This contract is fully invoiced')

  const allocations = sources.map((source) => ({
    sourceLineItemId: source.sourceLineItemId,
    amount: Math.floor((requestedAmount * source.amount) / available),
  }))
  let remainder = requestedAmount - allocations.reduce((sum, row) => sum + row.amount, 0)
  if (remainder > 0) {
    const byCapacity = [...sources]
      .map((source, index) => ({ source, index }))
      .sort(
        (a, b) =>
          b.source.amount - a.source.amount ||
          a.source.sourceLineItemId.localeCompare(b.source.sourceLineItemId)
      )
    for (const { source, index } of byCapacity) {
      const capacity = source.amount - allocations[index]!.amount
      const extra = Math.min(capacity, remainder)
      allocations[index]!.amount += extra
      remainder -= extra
      if (remainder === 0) break
    }
  }

  return allocations.filter((allocation) => allocation.amount > 0)
}

/** Resolve a fixed invoice amount against current contract and remaining value. */
export function resolveFixedInvoiceAmount(input: {
  selection:
    | { type: 'remaining' }
    | { type: 'percentage'; value: number }
    | { type: 'fixed'; amount: number }
  contractValue: number
  remainingValue: number
}): number {
  const { selection, contractValue, remainingValue } = input
  let amount: number
  if (selection.type === 'remaining') amount = remainingValue
  else if (selection.type === 'fixed') amount = selection.amount
  else {
    if (!Number.isFinite(selection.value) || selection.value <= 0 || selection.value > 100) {
      throw new BadRequestError('Percentage must be greater than 0 and no more than 100')
    }
    amount = Math.round((contractValue * selection.value) / 100)
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new BadRequestError('Invoice amount must be a positive integer number of cents')
  }
  if (amount > remainingValue) {
    throw new BadRequestError('Invoice amount exceeds the remaining contract value')
  }
  return amount
}
