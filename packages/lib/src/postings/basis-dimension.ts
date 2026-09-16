// packages/lib/src/postings/basis-dimension.ts
import { z } from 'zod'

/**
 * Which BOOK an accepted accounting effect belongs to — decision D13 of
 * plans/accounting/tasks/44-money-and-accounting-effect-contracts.md.
 *
 * 🛑 RESERVED, not built. Nothing writes it and nothing reads it. It exists now
 * because an `AccountingEffect`'s `acceptedBasis` is IMMUTABLE and its
 * `basisHash` is a sha256 over the canonical JSON: adding a dimension to frozen,
 * hashed records afterwards means rehashing every one of them. Reserving the
 * dimension costs one optional field; retrofitting it does not.
 *
 * ⚠️ Reserving the dimension is not building the cash book. The substitution
 * rule the cash book needs — our sale is a shipment while the payment usually
 * precedes it, so a cash-basis entry is not the accrual entry re-dated — is
 * still owed, and `contribution[]` is the grain it will work at.
 *
 * `.optional()` is load-bearing: an absent field serializes to the same
 * canonical JSON it always did, so every existing `basisHash` still verifies.
 */
export const reservedAccountingBasis = z.enum(['accrual', 'cash']).optional()

/** The book an entry belongs to. `undefined`/NULL is the single book we keep today. */
export type AccountingBasisDimension = 'accrual' | 'cash'
