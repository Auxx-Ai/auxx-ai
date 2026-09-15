// packages/lib/src/postings/effect-basis.ts
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { UnprocessableEntityError } from '../errors'

/** Canonical JSON preserves array order and sorts object keys, refusing non-JSON inputs. */
export function canonicalAccountingJson(value: unknown): string {
  const json = z.json().parse(value)
  function encode(input: z.infer<ReturnType<typeof z.json>>): string {
    if (Array.isArray(input)) return '[' + input.map(encode).join(',') + ']'
    if (input !== null && typeof input === 'object') {
      return (
        '{' +
        Object.keys(input)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode(input[key]!))
          .join(',') +
        '}'
      )
    }
    return JSON.stringify(input)
  }
  return encode(json)
}

/** Stable fingerprint of the exact validated input, independent of object property order. */
export function accountingBasisHash(value: unknown): string {
  return createHash('sha256').update(canonicalAccountingJson(value)).digest('hex')
}

/** Original identity deliberately excludes date, policy, grouping and input hash. */
export function fulfillmentAccountingEffectKey(fulfillmentInstanceId: string): string {
  if (!fulfillmentInstanceId) throw new UnprocessableEntityError('A fulfillment ID is required')
  return 'fulfillment_accounting:' + JSON.stringify([fulfillmentInstanceId, 'original'])
}

/** Stable original identity for one confirmed customer receipt movement. */
export function customerReceiptAccountingEffectKey(moneyTransactionId: string): string {
  if (!moneyTransactionId) throw new UnprocessableEntityError('A money transaction ID is required')
  return 'customer_receipt:' + JSON.stringify([moneyTransactionId, 'original'])
}

/** Corrections have a command identity against the frozen original, never another original. */
export function correctionAccountingEffectKey(
  originalEffectId: string,
  commandKey: string,
  componentKey: string
): string {
  if (![originalEffectId, commandKey, componentKey].every(Boolean))
    throw new UnprocessableEntityError('Correction identity is incomplete')
  return (
    'fulfillment_accounting:correction:' +
    JSON.stringify([originalEffectId, commandKey, componentKey])
  )
}

/** Stable correction identity for a customer receipt effect. */
export function customerReceiptCorrectionAccountingEffectKey(
  originalEffectId: string,
  commandKey: string,
  componentKey: string
): string {
  if (![originalEffectId, commandKey, componentKey].every(Boolean))
    throw new UnprocessableEntityError('Correction identity is incomplete')
  return (
    'customer_receipt:correction:' + JSON.stringify([originalEffectId, commandKey, componentKey])
  )
}

/** Convert exact money only when the current USD ledger can represent it without loss. */
export function toLedgerMinor(
  amountMinor: bigint | string,
  currency: string,
  currencyExponent: number
): number {
  if (
    currency !== 'USD' ||
    currencyExponent !== 2 ||
    (typeof amountMinor === 'string' && !/^(0|[1-9][0-9]*)$/.test(amountMinor))
  ) {
    throw new UnprocessableEntityError('The current ledger requires exact USD minor units')
  }
  const value = BigInt(amountMinor)
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new UnprocessableEntityError('Money exceeds the current ledger safe-number boundary')
  return Number(value)
}

/** Capture an existing builder's integer amount before serializing it into a durable basis. */
export function fromLedgerMinor(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new UnprocessableEntityError('Ledger money must be a safe nonnegative integer')
  return String(amountMinor)
}
