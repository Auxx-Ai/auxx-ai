// packages/lib/src/postings/basis-hash.ts
//
// The pure half of the deleted `effect-basis.ts`: a stable content hash and the
// two USD minor-unit converters. No effects, no schemas, no I/O.

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

/** The inverse of {@link toLedgerMinor}, for a builder amount going back into JSON. */
export function fromLedgerMinor(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new UnprocessableEntityError('Ledger money must be a safe nonnegative integer')
  return String(amountMinor)
}
