// packages/lib/src/accounting/money/customer-money/recognition.ts

import { UnprocessableEntityError } from '../../../errors'
import { accountingBasisHash } from '../../ledger/builders/basis-hash'

/** Canonical dated events; amounts are exact minor units, never order paid-status estimates. */
export type OrderRecognitionEvent = {
  id: string
  effectiveDate: string
  occurredAt: string
} & (
  | { kind: 'receipt'; amountMinor: string }
  | { kind: 'fulfillment'; netMinor: string; taxMinor: string }
)

/** Credits for a receipt, debits for a shipment; tax is always newly recognized tax. */
export interface OrderRecognitionAllocation {
  id: string
  kind: OrderRecognitionEvent['kind']
  effectiveDate: string
  amountMinor: string
  depositMinor: string
  receivableMinor: string
  taxMinor: string
  /** Hash of this event and its predecessors, excluding future events. */
  historyHash: string
}

function exact(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new UnprocessableEntityError('Recognition amounts must be nonnegative exact minor units')
  return BigInt(value)
}

const min = (a: bigint, b: bigint) => (a < b ? a : b)
const positive = (value: bigint) => (value > 0n ? value : 0n)
const roundedShare = (amount: bigint, part: bigint, total: bigint) =>
  total === 0n ? 0n : (amount * part * 2n + total) / (total * 2n)

/**
 * Replay payment and shipment ownership in occurrence order. Receipts first settle AR.
 * Remaining funding is split proportionally with cumulative rounding until a shipment
 * changes the unearned components. Shipments release available deposits and recognize
 * only tax not already collected. The caller compares frozen accepted allocations before
 * admitting late evidence and serializes source reads and acceptance under the org lock.
 */
export function allocateOrderRecognition(input: {
  orderNetMinor: string
  orderTaxMinor: string
  events: readonly OrderRecognitionEvent[]
}): OrderRecognitionAllocation[] {
  const net = exact(input.orderNetMinor)
  const tax = exact(input.orderTaxMinor)
  if (net + tax === 0n) throw new UnprocessableEntityError('An order must have a positive total')
  const identities = new Set<string>()
  for (const event of input.events) {
    const key = `${event.kind}:${event.id}`
    if (!event.id || identities.has(key))
      throw new UnprocessableEntityError('Recognition events must have distinct source identities')
    identities.add(key)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(event.effectiveDate) ||
      !Number.isFinite(Date.parse(`${event.effectiveDate}T00:00:00Z`)) ||
      !Number.isFinite(Date.parse(event.occurredAt))
    )
      throw new UnprocessableEntityError(
        'Recognition requires a valid occurrence and accounting date'
      )
  }
  const events = [...input.events].sort(
    (a, b) =>
      Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
      (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'receipt' ? -1 : 1)
  )
  let receivable = 0n
  let deposits = 0n
  let recognizedTax = 0n
  let shippedNet = 0n
  let shippedTax = 0n
  let receipts = 0n
  let phaseTax = tax
  let phaseTotal = net + tax
  let phaseFunded = 0n
  let phaseTaxFunded = 0n
  return events.map((event, index) => {
    let depositMinor = 0n
    let receivableMinor = 0n
    let taxMinor = 0n
    let amountMinor: bigint
    if (event.kind === 'receipt') {
      amountMinor = exact(event.amountMinor)
      if (amountMinor === 0n || receipts + amountMinor > net + tax)
        throw new UnprocessableEntityError('Receipt amounts exceed the supported order capacity')
      receipts += amountMinor
      receivableMinor = min(amountMinor, receivable)
      receivable -= receivableMinor
      const funding = amountMinor - receivableMinor
      if (phaseFunded + funding > phaseTotal)
        throw new UnprocessableEntityError('Receipt funding exceeds the remaining order components')
      phaseFunded += funding
      const cumulativeTax = roundedShare(phaseFunded, phaseTax, phaseTotal)
      taxMinor = cumulativeTax - phaseTaxFunded
      phaseTaxFunded = cumulativeTax
      depositMinor = funding - taxMinor
      deposits += depositMinor
      recognizedTax += taxMinor
    } else {
      const eventNet = exact(event.netMinor)
      const eventTax = exact(event.taxMinor)
      shippedNet += eventNet
      shippedTax += eventTax
      if (shippedNet > net || shippedTax > tax || eventNet + eventTax === 0n)
        throw new UnprocessableEntityError('Shipment components exceed the supported order basis')
      depositMinor = min(eventNet, deposits)
      deposits -= depositMinor
      taxMinor = positive(shippedTax - recognizedTax)
      recognizedTax += taxMinor
      receivableMinor = eventNet - depositMinor + taxMinor
      receivable += receivableMinor
      amountMinor = eventNet + taxMinor
      phaseTax = tax - recognizedTax
      phaseTotal = net - shippedNet - deposits + phaseTax
      phaseFunded = 0n
      phaseTaxFunded = 0n
    }
    return {
      id: event.id,
      kind: event.kind,
      effectiveDate: event.effectiveDate,
      amountMinor: amountMinor.toString(),
      depositMinor: depositMinor.toString(),
      receivableMinor: receivableMinor.toString(),
      taxMinor: taxMinor.toString(),
      historyHash: accountingBasisHash({
        orderNetMinor: input.orderNetMinor,
        orderTaxMinor: input.orderTaxMinor,
        events: events.slice(0, index + 1),
      }),
    }
  })
}
/** Allocate each tax event against remaining jurisdiction balances, preserving every cent. */
export function allocateRecognitionTaxComponents(
  allocations: readonly OrderRecognitionAllocation[],
  components: readonly { componentKey: string; amountMinor: string }[]
): Map<string, { componentKey: string; amountMinor: string }[]> {
  const remaining = [...components]
    .sort((a, b) => a.componentKey.localeCompare(b.componentKey))
    .map((component) => ({
      componentKey: component.componentKey,
      amount: BigInt(component.amountMinor),
    }))
  if (
    new Set(remaining.map((c) => c.componentKey)).size !== remaining.length ||
    remaining.some((c) => c.amount < 0n)
  )
    throw new Error('Invalid tax components')
  const result = new Map<string, { componentKey: string; amountMinor: string }[]>()
  for (const allocation of allocations) {
    const amount = BigInt(allocation.taxMinor)
    const total = remaining.reduce((sum, c) => sum + c.amount, 0n)
    if (amount < 0n || amount > total)
      throw new Error('Tax allocation exceeds remaining component evidence')
    const shares = remaining.map((component) => ({
      componentKey: component.componentKey,
      amount: total === 0n ? 0n : (amount * component.amount) / total,
      remainder: total === 0n ? 0n : (amount * component.amount) % total,
    }))
    let cents = amount - shares.reduce((sum, c) => sum + c.amount, 0n)
    for (const share of [...shares].sort((a, b) =>
      a.remainder === b.remainder
        ? a.componentKey.localeCompare(b.componentKey)
        : a.remainder > b.remainder
          ? -1
          : 1
    )) {
      if (cents === 0n) break
      share.amount += 1n
      cents -= 1n
    }
    remaining.forEach((component, i) => {
      component.amount -= shares[i]!.amount
    })
    result.set(
      allocation.id,
      shares.map((c) => ({ componentKey: c.componentKey, amountMinor: c.amount.toString() }))
    )
  }
  return result
}
