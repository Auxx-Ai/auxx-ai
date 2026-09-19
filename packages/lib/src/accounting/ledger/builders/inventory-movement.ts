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
  /**
   * A COST-ONLY document: its movements carry quantity 0 and a signed extended
   * cost, so the shelf does not move and the ledger restates what it is worth
   * (73 §6.2 rule 2). The standard-cost roll is the first writer;
   * §7's landed-cost voucher is the second.
   */
  | 'revalue'
  /**
   * Goods sent BACK to the supplier on a vendor credit (73 §8.2). Distinct from
   * `return`, which is a customer's: the inventory credit is at the standard,
   * `grni` is debited at what the vendor is crediting, and the remainder - the
   * freight and duty capitalised on units we no longer hold - is `ppv`.
   */
  | 'return_to_vendor'

/**
 * What one `receive` movement accrued to parties other than the goods vendor
 * (73 §7.2). Every figure is EXTENDED and signed like the movement's own cost.
 *
 * The three together are what the receipt owes; the inventory debit is the
 * frozen standard, and the difference is `ppv`.
 */
export interface ReceiveAccrualInput {
  /** `qty x agreed price`. Credits `grni` - the goods vendor's bill clears it. */
  grniMinor: number
  /** `qty x (shippingCost + otherCost)`. Credits `freight_accrual`. */
  freightMinor: number
  /** `qty x agreed price x tariffRate/100`. Credits `duties_accrual`. */
  dutiesMinor: number
}

/**
 * The labour and overhead a relief carries out of inventory (73 §6.2 rule 3),
 * read off the finished good's frozen standard composition.
 *
 * Signed like the COGS debit: positive on a relief, negative on an un-relief.
 * The material share is never passed - it is the remainder, so the three legs
 * tie to the movements by construction.
 */
export interface ReliefCogsSplit {
  laborMinor: number
  overheadMinor: number
}

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
  /**
   * `kind: 'receive'` only. Absent means nothing was accrued and `grni` takes
   * the whole cost, which is what an ad hoc receipt against no supplier row does.
   */
  accrual?: ReceiveAccrualInput
  /**
   * `kind: 'return_to_vendor'` only: `qty x the agreed price the vendor is
   * crediting`, POSITIVE. Debits `grni`, so the credit's own money entry
   * (`Dr accounts_payable / Cr grni`) nets it to zero for those units.
   *
   * Absent puts the movement's whole frozen cost in `grni` - the mirror of a
   * receipt that accrued nothing.
   */
  grniReliefMinor?: number
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
  /**
   * A relief's labour and overhead share. Only `kind: 'sale'` reads it; without
   * it the whole relief lands on `cogs_product_cost`, which is what it did
   * before 73 §6.2 rule 3.
   */
  cogsSplit?: ReliefCogsSplit
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
const COUNTER_ROLE: Record<Exclude<InventoryDocumentKind, 'build' | 'return_to_vendor'>, string> = {
  sale: ACCOUNT_ROLES.COGS_PRODUCT_COST,
  receive: ACCOUNT_ROLES.GRNI,
  adjust: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
  return: ACCOUNT_ROLES.COGS_PRODUCT_COST,
  scrap: ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
  opening: ACCOUNT_ROLES.EQUITY_OPENING_BALANCE,
  revalue: ACCOUNT_ROLES.INVENTORY_REVALUATION,
}

/**
 * A receipt's four credit-side legs (73 §7.2): the goods vendor's `grni`, the
 * carrier's `freight_accrual`, the broker's `duties_accrual`, and `ppv` for
 * whatever the frozen standard differs from the three together.
 *
 * 🛑 **`ppv` is the plug, not a computed variance.** The inventory debit is the
 * standard and the three credits are today's landed estimate; making the
 * remainder anything other than the balancing figure would emit an entry that
 * does not balance. On §6.4's provisional first receipt the standard has just
 * been replaced by that same estimate, so the plug is zero without a flag.
 *
 * A movement with no {@link ReceiveAccrualInput} puts its whole cost in `grni`,
 * which is what an ad hoc receipt against no supplier row accrues.
 */
function receiveCounterLegs(
  movements: readonly InventoryMovementLine[],
  net: number,
  documentId: string,
  memo: string | undefined
): Leg[] {
  let grni = 0
  let freight = 0
  let duties = 0
  for (const movement of movements) {
    const accrual = movement.accrual
    if (!accrual) {
      grni += movement.extendedCostMinor
      continue
    }
    assertMinor(accrual.grniMinor, `Movement ${movement.id} goods accrual`)
    assertMinor(accrual.freightMinor, `Movement ${movement.id} freight accrual`)
    assertMinor(accrual.dutiesMinor, `Movement ${movement.id} duties accrual`)
    grni += accrual.grniMinor
    freight += accrual.freightMinor
    duties += accrual.dutiesMinor
  }

  return [
    { role: ACCOUNT_ROLES.GRNI, amountMinor: -grni, memo, sourceId: documentId },
    {
      role: ACCOUNT_ROLES.FREIGHT_ACCRUAL,
      amountMinor: -freight,
      memo: 'Inbound freight accrued on receipt',
      sourceId: documentId,
    },
    {
      role: ACCOUNT_ROLES.DUTIES_ACCRUAL,
      amountMinor: -duties,
      memo: 'Duty accrued on receipt',
      sourceId: documentId,
    },
    {
      role: ACCOUNT_ROLES.PPV,
      amountMinor: grni + freight + duties - net,
      memo: 'Receipt against standard',
      sourceId: documentId,
    },
  ]
}

/**
 * A supplier return's two counter-legs (73 §8.2): `grni` at what the vendor is
 * crediting, and `ppv` for the rest of the standard that left the shelf.
 *
 * 🛑 **The `grni` debit is the CREDIT's figure, not the order's.** It has to
 * equal what the credit's own money entry credits `grni` for, or the two halves
 * of one supplier return leave a residue in an account whose whole job is to net
 * to zero per line. `ppv` is the balancing plug for the freight and duty the
 * standard capitalised on units we no longer hold.
 */
function returnToVendorCounterLegs(
  movements: readonly InventoryMovementLine[],
  net: number,
  documentId: string,
  memo: string | undefined
): Leg[] {
  let grni = 0
  for (const movement of movements) {
    if (movement.grniReliefMinor === undefined) {
      grni += -movement.extendedCostMinor
      continue
    }
    assertMinor(movement.grniReliefMinor, `Movement ${movement.id} goods credit`)
    grni += movement.grniReliefMinor
  }

  return [
    { role: ACCOUNT_ROLES.GRNI, amountMinor: grni, memo, sourceId: documentId },
    {
      role: ACCOUNT_ROLES.PPV,
      amountMinor: -net - grni,
      memo: 'Returned to vendor against standard',
      sourceId: documentId,
    },
  ]
}

/**
 * Build one document's inventory entry, or `null` when it moves no money.
 *
 * The shape per kind, with the sign always following the movements:
 *
 * ```
 * sale      Dr cogs_product_cost (+ cogs_direct_labor + applied_overhead when
 *           the finished good's standard is split)   Cr <inventory role(s)>
 * receive   Dr <inventory role(s)> at standard
 *           Cr grni, Cr freight_accrual, Cr duties_accrual, Dr|Cr ppv remainder
 * adjust    Dr/Cr <inventory role(s)>     Cr/Dr inventory_count_variance
 * scrap     Cr <inventory role(s)>        Dr inventory_count_variance
 * return    Dr <inventory role(s)>        Cr cogs_product_cost
 * return_to_vendor
 *           Cr <inventory role(s)> at standard
 *           Dr grni at the credited price, Dr|Cr ppv remainder
 * opening   Dr <inventory role(s)>        Cr equity_opening_balance
 * revalue   Dr/Cr <inventory role(s)>     Cr/Dr inventory_revaluation
 * build     Dr/Cr the three inventory roles against each other,
 *           Cr payroll_clearing, Cr applied_overhead, residual to build_variance
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
    // Its OWN role since 73 §6.2 rule 5: scrap and a run that missed standard
    // are not a vendor's price moving.
    legs.push({
      role: ACCOUNT_ROLES.BUILD_VARIANCE,
      amountMinor: -(net - labor - overhead),
      memo: 'Build variance',
      sourceId: documentId,
    })
  } else if (kind === 'receive') {
    legs.push(...receiveCounterLegs(movements, net, documentId, input.memo))
  } else if (kind === 'return_to_vendor') {
    legs.push(...returnToVendorCounterLegs(movements, net, documentId, input.memo))
  } else if (kind === 'sale' && input.cogsSplit) {
    const { laborMinor, overheadMinor } = input.cogsSplit
    assertMinor(laborMinor, 'Relieved labour')
    assertMinor(overheadMinor, 'Relieved overhead')
    legs.push(
      {
        role: ACCOUNT_ROLES.COGS_DIRECT_LABOR,
        amountMinor: laborMinor,
        memo: 'Direct labour relieved at standard',
        sourceId: documentId,
      },
      {
        role: ACCOUNT_ROLES.APPLIED_OVERHEAD,
        amountMinor: overheadMinor,
        memo: 'Overhead relieved at standard',
        sourceId: documentId,
      },
      // The remainder, so the three COGS legs tie to the movements exactly
      // whatever the components round to.
      {
        role: ACCOUNT_ROLES.COGS_PRODUCT_COST,
        amountMinor: -net - laborMinor - overheadMinor,
        memo: input.memo,
        sourceId: documentId,
      }
    )
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
