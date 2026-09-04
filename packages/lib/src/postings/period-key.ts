// packages/lib/src/postings/period-key.ts

/**
 * Minting a `GlPosting.periodKey` from a row id, deterministically.
 *
 * PURE. No database, no clock. Factored out of `build-payment-entry.ts` when a
 * SECOND kind of entry needed the same trick (the deposit application, keyed on
 * an allocation row's id), because two copies of a hash are two keyspaces that
 * are free to drift and a drifted keyspace is undetectable: a re-post that
 * should converge to `already_posted` would instead mint a second entry, and
 * every reader downstream sees two perfectly balanced postings of the same
 * event.
 *
 * ## Why a hash of the id and not a counted sequence
 *
 * The argument is `build-payment-entry.ts`'s and it is worth stating once here,
 * where the mechanism lives.
 *
 * `PaymentTransaction` and `PaymentAllocation` both have **no number column** -
 * nothing short and stable to key on. Their ids are 24-character cuids, and
 * `AUXX-PMT-<cuid>` blows the 21-character document-number cap on its own.
 *
 * The obvious alternative - `PMT-0001`, `PMT-0002`, counted off the existing
 * postings - is the one shape that is actively dangerous. Two rows processed
 * concurrently both read the same count and mint the same key; the claim's
 * unique index on `(organizationId, postingType, periodKey, revision)` then
 * converges the loser to `already_posted`, which is a SUCCESS status. Two
 * different events would silently become one entry and the loser's money would
 * never appear. A hash of the id cannot do that: it is deterministic, so a
 * re-post of the same row converges correctly - which is what `already_posted`
 * is FOR - and it needs no lock.
 *
 * 🛑 **It is not collision-PROOF, only collision-unlikely.** Six base-36 digits
 * is a keyspace of 36^6 = 2.2e9, so two DISTINCT ids can in principle fold to
 * one key, and the loser converges to `already_posted` with its money never
 * posted. Every caller of this function therefore owes a check on the winning
 * posting's line `sourceId` before it trusts `already_posted` - see
 * `postPaymentTransaction`, which does exactly that. Do not widen or narrow the
 * fold without reading it.
 */

import { UnprocessableEntityError } from '../errors'
import { DOC_NUMBER_MAX_LENGTH } from './doc-number'

/**
 * How many characters of compacted period key fit inside a document number,
 * with room for a reversal suffix.
 *
 * `AUXX-XXX-` is nine characters and `-R9` is three, so nine are left.
 *
 * 🛑 The `-R9` headroom is the half that is easy to drop, and dropping it is
 * the worst possible bug: a key that compacts to twelve characters posts
 * perfectly at revision 0 (nine plus twelve is exactly 21) and then REFUSES the
 * day somebody reverses it, at 24. The entry would be in the books with no way
 * to take it out. Every builder in this folder checks the reversal-inclusive
 * cap up front for this reason.
 */
export const MAX_COMPACT_PERIOD_KEY = DOC_NUMBER_MAX_LENGTH - 'AUXX-XXX-'.length - '-R9'.length

/** How many base-36 digits the folded hash renders as. */
const HASH_DIGITS = 6

/**
 * Fold an id into {@link HASH_DIGITS} base-36 digits.
 *
 * FNV-1a, 32 bit. Not cryptographic and does not need to be: this is a
 * keyspace, not a secret, and a pure function beats importing `node:crypto`
 * into a file that has to stay client-safe.
 *
 * Folded with a modulus rather than sliced, so all 32 bits contribute to the
 * six digits that survive - a slice would throw away the high digit's entropy
 * for nothing.
 */
function foldId(id: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const folded = hash % 36 ** HASH_DIGITS
  return folded.toString(36).toUpperCase().padStart(HASH_DIGITS, '0')
}

export interface HashedPeriodKeyInput {
  /** Three letters, matching this posting type's `DOC_NUMBER_PREFIX`. */
  prefix: string
  /** The row id to key on. Blank refuses. */
  sourceId: string
  /** What the id names, for the refusal message - `'payment entry'`. */
  label: string
  /** What the id IS, for the refusal message. Defaults to `'row id'`. */
  idLabel?: string
}

/**
 * Mint a deterministic `<PREFIX>-<6 base36>` period key from a row id.
 *
 * @throws {UnprocessableEntityError} on a blank id, or on a composed key that
 *   would not survive a reversal inside the document-number cap.
 */
export function hashedPeriodKey(input: HashedPeriodKeyInput): string {
  const { prefix, label, idLabel = 'row id' } = input
  const id = input.sourceId.trim()
  if (!id) {
    throw new UnprocessableEntityError(`A ${label} needs the ${idLabel} to key on`)
  }

  const key = `${prefix}-${foldId(id)}`
  const compact = key.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_PERIOD_KEY) {
    // Unreachable while the prefix is three characters and the fold six.
    // Asserted so a widening of either cannot quietly mint an unpostable key.
    throw new UnprocessableEntityError(
      `Period key "${key}" compacts to ${compact.length} characters, over ${MAX_COMPACT_PERIOD_KEY}`,
      { periodKey: key }
    )
  }
  return key
}

/**
 * Refuse a DOCUMENT NUMBER that would not survive a reversal.
 *
 * The other half of the keyspace: types that key on a record's own number
 * (`'INV-0042'`) rather than on a hash. Same cap, same `-R9` headroom, same
 * reason.
 *
 * @returns the number, trimmed, so a caller can use the result directly.
 * @throws {UnprocessableEntityError} on a blank or over-long number.
 */
export function assertCompactablePeriodKey(input: {
  value: string | null | undefined
  /** What the value is, for the message - `'Invoice number'`. */
  label: string
  /** Appended to the refusal: what the reader should do instead. */
  remedy: string
  context?: Record<string, string>
}): string {
  const { label, remedy, context } = input
  const value = input.value?.trim() ?? ''
  if (value.length === 0) {
    throw new UnprocessableEntityError(
      `${label} is empty, and an entry needs it to key its document number on`,
      context
    )
  }
  const compact = value.replace(/-/g, '')
  if (compact.length > MAX_COMPACT_PERIOD_KEY) {
    throw new UnprocessableEntityError(
      `${label} "${value}" compacts to ${compact.length} characters and a document number ` +
        `allows ${MAX_COMPACT_PERIOD_KEY} (${DOC_NUMBER_MAX_LENGTH} characters total, less the ` +
        `"AUXX-XXX-" prefix and a reversal suffix). ${remedy}`,
      { ...context, length: String(compact.length) }
    )
  }
  return value
}
