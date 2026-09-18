// packages/lib/src/accounting/ledger/builders/inventory-movement.ts
//
// One entry per inventory DOCUMENT, at the movements' own frozen cost.
//
// PURE. No database, no clock, no settings. It takes the `stock_movement` rows a
// document just wrote - their signed `stock_movement_extended_cost` and their
// frozen `stock_movement_gl_account` role - sums them by role, and adds the one
// counter-leg the document kind implies. `stock_movement` is the subledger and
// the GL carries one entry per document with member links to it (TARGET §5).
//
// 🛑 **Nothing here re-derives a cost.** A movement's extended cost was frozen
// when the row was written; re-multiplying today's standard cost by the quantity
// would restate a shipment months later, which is the exact failure every writer
// in `inventory/movements/` exists to prevent.
//
// 🛑 **A zero-cost document builds NOTHING and says so** - `null`, not an entry
// of two zero legs. `buildEntry` refuses a zero-amount line, so the alternative
// to `null` is a throw on the most ordinary case there is (a build whose consume
// and produce legs net exactly, a run of movements that were all skipped).

import { UnprocessableEntityError } from '../../../errors'
import type { BuiltEntry, GlPostingLineInput } from '../types'
import { ACCOUNT_ROLES, buildEntry } from './entry'

/**
 * Which document wrote the movements, and therefore what the counter-leg is.
 *
 * It travels in the built envelope rather than in a second posting type because
 * every kind claims, exports and reverses identically - `avenueOfPostingType`
 * would give all seven the same answer.
 */
export type InventoryDocumentKind =
  | 'sale'
  | 'receive'
  | 'adjust'
  | 'build'
  | 'return'
  | 'scrap'
  | 'opening'

/** One `stock_movement` this document wrote, as the entry reads it. */
export interface InventoryMovementLine {
  /** The `stock_movement` EntityInstance id. Becomes a `member` source link. */
  id: string
  /**
   * SIGNED `stock_movement_extended_cost`, integer minor units.
   *
   * The movement's TYPE is deliberately not an input: the sign and the frozen
   * account already say everything the entry needs, and a builder that branched
   * on the type could disagree with the row it is booking.
   */
  extendedCostMinor: number
  /** The movement's frozen `stock_movement_gl_account` - an inventory ROLE. */
  glAccountRole: string
}

export interface InventoryMovementEntryInput {
  kind: InventoryDocumentKind
  /** The subject's source kind - `'fulfillment'`, `'stock_movement'`, `'build'`. */
  documentKind: string
  /** The subject's source id. Also the entry's `periodKey`, so the claim is per document. */
  documentId: string
  /** `YYYY-MM-DD`. The document's own accounting date, never today. */
  txnDate: string
  movements: readonly InventoryMovementLine[]
  /**
   * A build's absorbed labour and overhead, signed like the movements (negated
   * on a reversing build). Only `kind: 'build'` reads them: the produce leg is
   * worth more than the components it consumed by exactly what was absorbed,
   * and without these that difference would land in purchase price variance.
   */
  absorbed?: { laborMinor: number; overheadMinor: number }
  memo?: string
}

/** The entry plus the movement ids the caller must link as members. */
export interface BuiltInventoryMovementEntry {
  entry: BuiltEntry
  memberMovementIds: string[]
}

function assertMinor(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new UnprocessableEntityError(
      `${label} must be an integer number of minor units, got ${String(value)}`,
      { amount: String(value) }
    )
  }
}

/** A draft leg, before zero legs are dropped and the sign is split off. */
interface Leg {
  role: string
  /** SIGNED. Positive is a debit. */
  amountMinor: number
  memo?: string
  sourceId: string
}

/**
 * The counter-leg role for every kind but `build`, which has three.
 *
 * `return` credits cost of goods sold rather than a returns account: putting a
 * unit back on the shelf un-books what the sale charged to COGS, and the revenue
 * side of the return is the credit memo's entry, not this one.
 */
const COUNTER_ROLE: Record<Exclude<InventoryDocumentKind, 'build'>, string> = {
  sale: ACCOUNT_ROLES.COGS_PRODUCT_COST,
  receive: ACCOUNT_ROLES.GRNI,
  adjust: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
  return: ACCOUNT_ROLES.COGS_PRODUCT_COST,
  scrap: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
  opening: ACCOUNT_ROLES.EQUITY_OPENING_BALANCE,
}

/**
 * Build one document's inventory entry, or `null` when it moves no money.
 *
 * The shape per kind, with the sign always following the movements:
 *
 * ```
 * sale      Dr cogs_product_cost          Cr <inventory role(s)>
 * receive   Dr <inventory role(s)>        Cr grni
 * adjust    Dr/Cr <inventory role(s)>     Cr/Dr inventory_count_variance
 * scrap     Cr <inventory role(s)>        Dr inventory_count_variance
 * return    Dr <inventory role(s)>        Cr cogs_product_cost
 * opening   Dr <inventory role(s)>        Cr equity_opening_balance
 * build     Dr/Cr the three inventory roles against each other,
 *           Cr payroll_clearing, Cr applied_overhead, and the residual to ppv
 * ```
 *
 * @throws {UnprocessableEntityError} on a non-integer cost, a movement with no
 * frozen account role, or (via `buildEntry`) an entry that does not balance.
 */
export function buildInventoryMovementEntry(
  input: InventoryMovementEntryInput
): BuiltInventoryMovementEntry | null {
  const { kind, documentId, txnDate, movements } = input

  const byRole = new Map<string, number>()
  let net = 0
  for (const movement of movements) {
    assertMinor(movement.extendedCostMinor, `Movement ${movement.id} extended cost`)
    const role = movement.glAccountRole?.trim()
    if (!role) {
      throw new UnprocessableEntityError(
        `Movement ${movement.id} carries no frozen inventory account and cannot be posted`,
        { movementId: movement.id }
      )
    }
    byRole.set(role, (byRole.get(role) ?? 0) + movement.extendedCostMinor)
    net += movement.extendedCostMinor
  }

  const legs: Leg[] = []
  for (const [role, amountMinor] of byRole) {
    legs.push({ role, amountMinor, memo: input.memo, sourceId: documentId })
  }

  if (kind === 'build') {
    const labor = input.absorbed?.laborMinor ?? 0
    const overhead = input.absorbed?.overheadMinor ?? 0
    assertMinor(labor, 'Absorbed labour')
    assertMinor(overhead, 'Absorbed overhead')
    legs.push({
      role: ACCOUNT_ROLES.PAYROLL_CLEARING,
      amountMinor: -labor,
      memo: 'Labour absorbed into this build',
      sourceId: documentId,
    })
    legs.push({
      role: ACCOUNT_ROLES.APPLIED_OVERHEAD,
      amountMinor: -overhead,
      memo: 'Overhead absorbed into this build',
      sourceId: documentId,
    })
    // What the run produced beyond the components and the absorption it
    // consumed. Favourable is a credit, exactly as a vendor billing low is.
    legs.push({
      role: ACCOUNT_ROLES.PPV,
      amountMinor: -(net - labor - overhead),
      memo: 'Build variance',
      sourceId: documentId,
    })
  } else {
    legs.push({
      role: COUNTER_ROLE[kind],
      amountMinor: -net,
      memo: input.memo,
      sourceId: documentId,
    })
  }

  const lines: GlPostingLineInput[] = legs
    .filter((leg) => leg.amountMinor !== 0)
    .map((leg, index) => ({
      accountRole: leg.role,
      direction: leg.amountMinor > 0 ? ('debit' as const) : ('credit' as const),
      amount: Math.abs(leg.amountMinor),
      memo: leg.memo,
      sourceType: 'stock_movement',
      sourceId: leg.sourceId,
      sortOrder: index,
    }))

  // Nothing moved in money terms. The caller skips; it is not a refusal.
  if (lines.length === 0) return null

  return {
    entry: buildEntry({
      postingType: 'inventory_movement',
      // The DOCUMENT is the claim's identity: one live entry per document,
      // whatever month it falls in.
      periodKey: documentId,
      txnDate,
      lines,
    }),
    memberMovementIds: movements.map((movement) => movement.id),
  }
}
