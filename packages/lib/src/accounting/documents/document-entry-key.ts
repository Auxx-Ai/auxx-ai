// packages/lib/src/accounting/documents/document-entry-key.ts

import { hashedPeriodKey, MAX_COMPACT_PERIOD_KEY } from '../ledger/periods/period-key'

/** How a family names its hashed fallback key. `BGN-<hash>` for a vendor bill. */
export interface DocumentEntryKeyHash {
  /** Three characters. Longer and the hashed key will not compact. */
  prefix: string
  /** What the key is for, in a refusal — `'vendor bill repost'`. */
  label: string
}

/**
 * The claim and document-number key for one generation of a document's entry.
 *
 * Generation 1 is the internal number verbatim (`BILL-0002` -> `AUXX-BIL-BILL0002`)
 * and must stay so, or every document already in a ledger re-keys. A repost
 * cannot reuse it: Save reverses the original at `-R1`, which frees the CLAIM but
 * leaves `AUXX-BIL-BILL0002` standing on the reversed row, and `docNumber` is
 * unique per org.
 *
 * So a repost keys on the number's DIGITS plus a generation marker -
 * `0002G2` -> `AUXX-BIL-0002G2`, whose own reversal `AUXX-BIL-0002G2-R1` is 18
 * of the 21 characters allowed. `BILL0002G2` would be 10 against a 9-character
 * budget and does not fit. When the internal number carries no digits, or the
 * marker would not fit beside them, the key falls back to a 6-digit hash of the
 * number and the generation (`<prefix>-<hash>`), which always fits.
 */
export function documentEntryKey(
  internalNumber: string,
  generation: number,
  hash: DocumentEntryKeyHash
): string | undefined {
  if (generation <= 1) return undefined
  const digits = internalNumber.replace(/\D/g, '')
  const marked = `${digits}G${generation}`
  if (digits.length > 0 && marked.length <= MAX_COMPACT_PERIOD_KEY) return marked
  return hashedPeriodKey({
    prefix: hash.prefix,
    sourceId: `${internalNumber}:${generation}`,
    label: hash.label,
    idLabel: 'internal number',
  })
}
