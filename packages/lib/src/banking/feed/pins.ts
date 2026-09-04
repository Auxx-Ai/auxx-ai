// packages/lib/src/banking/feed/pins.ts

/**
 * Freezing a bank transaction's RAW columns once it has been posted to the ledger.
 *
 * 🛑 **The case this exists for is real and silent.** A pending charge of $1,240.00 is
 * coded and posted; it then settles at the bank for $1,255.00. Contributing mode's
 * per-field ownership stops the connector writing the REVIEW columns, but nothing stops
 * it correcting a raw one - and rewriting `amountMinor` under a posting leaves a
 * `GlPosting` that no longer matches its source document and still balances perfectly,
 * so nothing downstream can detect it (plans/bank-connection/02 §5.2).
 *
 * The mechanism is `DataConnectorItem.pinnedFields`, which the entity sink already
 * honours per record per field in `buildWriteSet`. That was the recommendation in
 * `plans/accounting/implementation-review.md` §2 precisely because it **needs no engine
 * change**: the alternative (a `rowGuard` predicate on the mapping) would add a hook to
 * the sink for one consumer.
 *
 * ## The contract with the poster (slot 3B)
 *
 * The connector cannot pin: it never sees a posting. The POSTER pins, in the same
 * transaction that stamps `glPostingId`, by calling {@link pinPostedBankTransaction}.
 * Reversing a posting calls {@link unpinPostedBankTransaction}, which lets the next
 * sync heal the row back to what the bank now says - which is the whole point of
 * correcting by reversal rather than by edit.
 *
 * ⚠️ A pin is per (connector, record, field), so it is a no-op on an IMPORTED row
 * (`source: 'import'`), which has no `DataConnectorItem` binding at all. That is
 * correct: nothing is going to rewrite an imported row behind the poster's back.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { setConnectorFieldPin } from '../../data-connectors/mutations'
import { loadBankTransactionFieldContext } from '../reads'

const logger = createScopedLogger('banking-feed')

/**
 * The raw columns the connector owns and the poster freezes.
 *
 * ⚠️ `matchKey` and `source` are deliberately NOT here. They are derived, not
 * transcribed: re-normalising a description the bank corrected is harmless, and a row's
 * source cannot change. Pinning them would only make a healed description disagree with
 * the key derived from it.
 *
 * 🛑 **`bankStatus` is deliberately NOT here either, and that is a correction.** The
 * fields that corrupt a posting are the ones the entry was BUILT from - the amount, the
 * date, the account, the identity - and `bankStatus` is none of them. What it does carry
 * is the bank withdrawing the transaction: a pending charge that was coded and then
 * VOIDED. The sink drops a pinned field silently (`entity-sink.ts` `buildWriteSet`), so
 * pinning it would leave the row reading `pending` forever, a posting standing in the
 * books for money that never moved, and no signal anywhere - where an unpinned status
 * flips the row to `void`, which is what the queue shows and what `undoReview` is for
 * (a void line is deliberately still undoable).
 */
const PINNED_ATTRIBUTES = [
  'bank_transaction_external_id',
  'bank_transaction_bank_account',
  'bank_transaction_posted_at',
  'bank_transaction_description',
  'bank_transaction_amount',
] as const

export interface BankTransactionPinInput {
  organizationId: string
  /** The `bank_transaction` `EntityInstance.id`. */
  bankTransactionId: string
  /** The `DataConnector` that feeds this row - `bank_account.connectorId`. */
  connectorId: string
}

/**
 * Freeze the raw columns of one posted bank transaction against the feed.
 *
 * Call it from the poster, after the `glPostingId` write. Safe to call twice (the pin
 * append is idempotent by construction) and safe to call on a row the connector does
 * not bind - `setConnectorFieldPin` answers `NotFoundError` for an unbound record and
 * this swallows it, because "an imported row has nothing to pin" is an ordinary
 * outcome, not a posting failure.
 *
 * 🛑 It never throws. A posting must not fail because its provenance bookkeeping did  -
 * the same rule `postPaymentTransaction` follows.
 *
 * @returns how many fields were pinned (0 when the row is not connector-bound).
 */
export async function pinPostedBankTransaction(
  db: Database,
  input: BankTransactionPinInput
): Promise<number> {
  return setPins(db, input, true)
}

/**
 * Release the pins when a posting is reversed, so the next sync heals the row.
 *
 * The mirror of {@link pinPostedBankTransaction}, and the reason the pin is the right
 * mechanism rather than a permanent capability: correcting by reversal has to actually
 * restore the row to what the bank says, or the amended amount stays invisible forever.
 */
export async function unpinPostedBankTransaction(
  db: Database,
  input: BankTransactionPinInput
): Promise<number> {
  return setPins(db, input, false)
}

async function setPins(
  db: Database,
  input: BankTransactionPinInput,
  pinned: boolean
): Promise<number> {
  const ctx = await loadBankTransactionFieldContext(input.organizationId)
  if (!ctx) return 0

  // `loadBankTransactionFieldContext` resolves only the two fields the coverage read
  // needs, so the full set is read here from the same cache.
  const { getOrgCache } = await import('../../cache')
  const fields = (await getOrgCache()
    .from(input.organizationId, 'customFields')
    .bySystemAttributes([...PINNED_ATTRIBUTES])) as Record<string, { id: string } | null>

  let changed = 0
  for (const attribute of PINNED_ATTRIBUTES) {
    const field = fields[attribute]
    if (!field) continue
    const result = await setConnectorFieldPin(db, {
      organizationId: input.organizationId,
      entityInstanceId: input.bankTransactionId,
      fieldId: field.id,
      connectorId: input.connectorId,
      pinned,
    })
    if (result.isOk()) changed += 1
  }

  if (changed > 0) {
    logger.info(pinned ? 'Pinned a posted bank transaction' : 'Released a bank transaction pin', {
      organizationId: input.organizationId,
      bankTransactionId: input.bankTransactionId,
      fields: changed,
    })
  }
  return changed
}
