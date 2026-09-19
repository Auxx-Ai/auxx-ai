// packages/lib/src/accounting/ledger/builders/movement-key.ts

/**
 * The claim key for one money movement's entry — a payment or a refund.
 *
 * PURE. Beside `inventoryPeriodKey` and `depositApplicationPeriodKey`, and for
 * the same reason: `MoneyTransaction` has no number column, its id is a
 * 24-character cuid, and `AUXX-PMT-<cuid>` is 33 against a 21-character cap.
 */

import { hashedPeriodKey } from '../periods/period-key'
import { DOC_NUMBER_PREFIX } from './doc-number'

/** The two posting types a `MoneyTransaction` mints an entry for. */
export type MovementPostingType = 'payment' | 'refund'

/**
 * `PMT-<6 base36>` / `RFD-<6 base36>` from `MoneyTransaction.id`.
 *
 * 🛑 Never the book date. Two payments settle on one day routinely, and a date
 * key mints ONE document number for both — the second loses
 * `GlPosting_org_docNumber_key` and cannot post at all. It inherits
 * `hashedPeriodKey`'s collision caveat, which the subject claim on
 * `(movement, money.id)` discharges: idempotency here is the claim's, not the
 * key's.
 *
 * @throws {UnprocessableEntityError} on a blank movement id.
 */
export function movementPeriodKey(
  postingType: MovementPostingType,
  moneyTransactionId: string
): string {
  return hashedPeriodKey({
    prefix: DOC_NUMBER_PREFIX[postingType],
    sourceId: moneyTransactionId,
    label: `${postingType} entry`,
    idLabel: 'money transaction id',
  })
}
