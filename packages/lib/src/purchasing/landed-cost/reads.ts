// packages/lib/src/purchasing/landed-cost/reads.ts

/**
 * What a shipment accrued for freight and duty against what has since been
 * billed for it (73 §7.2, "what the link gives before item 11").
 *
 * Two readings of the same pair of facts:
 *
 * - the receipts' own stamps (`stock_movement_freight_accrued` /
 *   `_duties_accrued`), written by 73 U5 when the goods were valued at standard;
 * - the landed-cost lines other vendors' bills carry, joined back through
 *   `vendor_bill_line_landed_bill` and split by the account each is coded to.
 *
 * Reads only. **No posting.** The difference is what the accrual balance already
 * says; naming it per shipment is what tells a person a shipping or tariff
 * estimate is running high or low. The landed-cost voucher that would post the
 * difference is follow-up item 11.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md` §6).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { readRoleAssignments } from '../../accounting/ledger/roles/role-assignments'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../resources/registry/resources/purchase-order-line-fields'
import { STOCK_MOVEMENT_FIELDS } from '../../resources/registry/resources/stock-movement-fields'
import { VENDOR_BILL_LINE_FIELDS } from '../../resources/registry/resources/vendor-bill-line-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFields } from '../../resources/system-records'
import { createGuard } from '../../utils/guard'
import type { LandedCostSummary, VendorPartLandedCostSummary } from './types'

const guard = createGuard('purchasing:landed-cost')

const BILL_LINE_ATTRIBUTES = pickSystemAttributes(VENDOR_BILL_LINE_FIELDS, [
  'vendor_bill_line_vendor_bill',
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_landed_bill',
  'vendor_bill_line_line_total',
  'vendor_bill_line_gl_account',
] as const)

const MOVEMENT_ATTRIBUTES = pickSystemAttributes(STOCK_MOVEMENT_FIELDS, [
  'stock_movement_purchase_order_line',
  'stock_movement_vendor_part',
  'stock_movement_freight_accrued',
  'stock_movement_duties_accrued',
  'stock_movement_tariff_rate',
] as const)

const ORDER_LINE_ATTRIBUTES = pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, [
  'purchase_order_line_vendor_part',
] as const)

/** The two accrual roles a landed-cost line may be coded to. */
interface AccrualAccounts {
  freightAccountId: string | null
  dutiesAccountId: string | null
}

/**
 * The org's own accounts for the two accrual roles, or `null` where unmapped.
 *
 * Read off `GlRoleAssignment` rather than through `resolveRoles`, which fails
 * closed: an unmapped role makes every landed line "other" on this card, which
 * is a coding gap to show, not a reason to refuse the read.
 */
async function readAccrualAccounts(db: Database, organizationId: string): Promise<AccrualAccounts> {
  const rows = await readRoleAssignments(db, organizationId)
  const find = (role: string) =>
    rows.find((row) => row.role === role && !row.markedUnused)?.glAccountId ?? null
  return { freightAccountId: find('freight_accrual'), dutiesAccountId: find('duties_accrual') }
}

/** One goods-bill line, with everything the apportionment needs. */
interface GoodsLine {
  lineId: string
  purchaseOrderLineId: string | null
  vendorPartId: string | null
  valueMinor: number
  /** The duty percentage the receipt froze; `0` when nothing was accrued. */
  tariffRate: number
}

/** What one receipt movement stamped. */
interface ReceiptAccrual {
  purchaseOrderLineId: string | null
  vendorPartId: string | null
  freightMinor: number
  dutiesMinor: number
  tariffRate: number
}

/** The whole picture for one goods bill, before it is summed or apportioned. */
interface BillLandedCost {
  goodsLines: GoodsLine[]
  receipts: ReceiptAccrual[]
  billedFreightMinor: number
  billedDutiesMinor: number
  billedOtherMinor: number
  landedLineCount: number
}

/**
 * Load one goods bill's own lines, the receipts behind them and the landed-cost
 * lines charged against it.
 *
 * Four reads regardless of the bill's size: its own lines, the landed lines
 * pointing back at it, the movements on its order lines, and those order lines.
 */
async function loadBillLandedCost(
  db: Database,
  organizationId: string,
  vendorBillId: string,
  accounts: AccrualAccounts
): Promise<BillLandedCost> {
  const lineCtx = await systemFields(db, organizationId, 'vendor_bill_line', BILL_LINE_ATTRIBUTES)
  if (!lineCtx) {
    return {
      goodsLines: [],
      receipts: [],
      billedFreightMinor: 0,
      billedDutiesMinor: 0,
      billedOtherMinor: 0,
      landedLineCount: 0,
    }
  }

  const [ownLines, landedLines] = await Promise.all([
    readSystemRecords(db, organizationId, lineCtx, {
      by: { attribute: 'vendor_bill_line_vendor_bill', in: [vendorBillId] },
    }),
    readSystemRecords(db, organizationId, lineCtx, {
      by: { attribute: 'vendor_bill_line_landed_bill', in: [vendorBillId] },
    }),
  ])

  let billedFreightMinor = 0
  let billedDutiesMinor = 0
  let billedOtherMinor = 0
  for (const line of landedLines) {
    const amount = line.number('vendor_bill_line_line_total') ?? 0
    const accountId = line.text('vendor_bill_line_gl_account')
    if (accountId && accountId === accounts.freightAccountId) billedFreightMinor += amount
    else if (accountId && accountId === accounts.dutiesAccountId) billedDutiesMinor += amount
    else billedOtherMinor += amount
  }

  const goodsLines: GoodsLine[] = ownLines.map((line) => ({
    lineId: line.id,
    purchaseOrderLineId: line.related('vendor_bill_line_purchase_order_line'),
    vendorPartId: null,
    valueMinor: line.number('vendor_bill_line_line_total') ?? 0,
    tariffRate: 0,
  }))

  const purchaseOrderLineIds = [
    ...new Set(goodsLines.map((line) => line.purchaseOrderLineId).filter((id) => id !== null)),
  ]
  const receipts = await loadReceiptAccruals(db, organizationId, {
    purchaseOrderLineIds,
  })

  // The vendor part and the rate come off the ORDER line and the receipt's own
  // stamp, never off today's supplier row: the shipment's duty was assessed on
  // the rate in force when it landed.
  const vendorPartByOrderLine = await loadOrderLineVendorParts(
    db,
    organizationId,
    purchaseOrderLineIds
  )
  const rateByOrderLine = new Map<string, number>()
  for (const receipt of receipts) {
    if (receipt.purchaseOrderLineId && receipt.tariffRate > 0) {
      rateByOrderLine.set(receipt.purchaseOrderLineId, receipt.tariffRate)
    }
  }
  for (const line of goodsLines) {
    if (!line.purchaseOrderLineId) continue
    line.vendorPartId = vendorPartByOrderLine.get(line.purchaseOrderLineId) ?? null
    line.tariffRate = rateByOrderLine.get(line.purchaseOrderLineId) ?? 0
  }

  return {
    goodsLines,
    receipts,
    billedFreightMinor,
    billedDutiesMinor,
    billedOtherMinor,
    landedLineCount: landedLines.length,
  }
}

/** The receipt movements on a set of order lines, or on a set of vendor parts. */
async function loadReceiptAccruals(
  db: Database,
  organizationId: string,
  scope: { purchaseOrderLineIds?: string[]; vendorPartIds?: string[] }
): Promise<ReceiptAccrual[]> {
  const by =
    scope.vendorPartIds !== undefined
      ? ({ attribute: 'stock_movement_vendor_part', in: scope.vendorPartIds } as const)
      : ({
          attribute: 'stock_movement_purchase_order_line',
          in: scope.purchaseOrderLineIds ?? [],
        } as const)
  if (by.in.length === 0) return []

  const ctx = await systemFields(db, organizationId, 'stock_movement', MOVEMENT_ATTRIBUTES)
  if (!ctx) return []

  const movements = await readSystemRecords(db, organizationId, ctx, { by })
  return movements
    .map((movement) => ({
      purchaseOrderLineId: movement.related('stock_movement_purchase_order_line'),
      vendorPartId: movement.related('stock_movement_vendor_part'),
      freightMinor: movement.number('stock_movement_freight_accrued') ?? 0,
      dutiesMinor: movement.number('stock_movement_duties_accrued') ?? 0,
      tariffRate: movement.number('stock_movement_tariff_rate') ?? 0,
    }))
    .filter((receipt) => receipt.freightMinor !== 0 || receipt.dutiesMinor !== 0)
}

/** `purchase_order_line` id -> its `vendor_part` instance id. */
async function loadOrderLineVendorParts(
  db: Database,
  organizationId: string,
  purchaseOrderLineIds: readonly string[]
): Promise<Map<string, string>> {
  if (purchaseOrderLineIds.length === 0) return new Map()
  const ctx = await systemFields(db, organizationId, 'purchase_order_line', ORDER_LINE_ATTRIBUTES)
  if (!ctx) return new Map()
  const records = await readSystemRecords(db, organizationId, ctx, { ids: purchaseOrderLineIds })
  const out = new Map<string, string>()
  for (const record of records) {
    const vendorPartId = record.related('purchase_order_line_vendor_part')
    if (vendorPartId) out.set(record.id, vendorPartId)
  }
  return out
}

function leg(accruedMinor: number, billedMinor: number) {
  return { accruedMinor, billedMinor, differenceMinor: accruedMinor - billedMinor }
}

/**
 * One goods bill: what its receipts accrued, what has been billed against it
 * through `vendor_bill_line_landed_bill`, and the difference.
 *
 * An expense bill with no order lines behind it reads as all zeroes rather than
 * as a refusal — a bill nobody has shipped against is a legal state.
 */
export async function readLandedCostByBill(
  db: Database,
  organizationId: string,
  vendorBillId: string
): Promise<Result<LandedCostSummary, Error>> {
  return guard(
    async () => {
      const accounts = await readAccrualAccounts(db, organizationId)
      const bill = await loadBillLandedCost(db, organizationId, vendorBillId, accounts)

      let accruedFreight = 0
      let accruedDuties = 0
      for (const receipt of bill.receipts) {
        accruedFreight += receipt.freightMinor
        accruedDuties += receipt.dutiesMinor
      }

      return {
        freight: leg(accruedFreight, bill.billedFreightMinor),
        duties: leg(accruedDuties, bill.billedDutiesMinor),
        otherBilledMinor: bill.billedOtherMinor,
        receiptCount: bill.receipts.length,
        landedLineCount: bill.landedLineCount,
      }
    },
    'Failed to read the landed cost for a vendor bill',
    { organizationId, vendorBillId }
  )
}

/**
 * One vendor part: what ITS receipts accrued, against its share of the
 * landed-cost lines on the goods bills those receipts belong to.
 *
 * **The split across parts is derived** (§7.2 "one total per shipment; never per
 * item"). Customs assesses one entry per shipment and the broker bills one line
 * for it, so a per-part figure can only be reproduced the way the 7501's own
 * arithmetic reproduces it:
 *
 * - duty, by `line value × the line's frozen tariff rate` — a zero-rate part
 *   takes nothing, and parts sharing a code split by value;
 * - freight, by line value alone — it is not assessed per code.
 *
 * A bill whose weights are all zero apportions nothing rather than dividing by
 * zero, which is the honest answer: nothing on it was dutiable.
 */
export async function readLandedCostByVendorPart(
  db: Database,
  organizationId: string,
  vendorPartId: string
): Promise<Result<VendorPartLandedCostSummary, Error>> {
  return guard(
    async () => {
      const accounts = await readAccrualAccounts(db, organizationId)
      const receipts = await loadReceiptAccruals(db, organizationId, {
        vendorPartIds: [vendorPartId],
      })

      let accruedFreight = 0
      let accruedDuties = 0
      for (const receipt of receipts) {
        accruedFreight += receipt.freightMinor
        accruedDuties += receipt.dutiesMinor
      }

      const billIds = await loadGoodsBillsForOrderLines(db, organizationId, [
        ...new Set(receipts.map((r) => r.purchaseOrderLineId).filter((id) => id !== null)),
      ])

      let billedFreight = 0
      let billedDuties = 0
      let billedOther = 0
      let landedLineCount = 0
      for (const billId of billIds) {
        const bill = await loadBillLandedCost(db, organizationId, billId, accounts)
        landedLineCount += bill.landedLineCount
        billedFreight += apportion(bill.goodsLines, vendorPartId, bill.billedFreightMinor, false)
        billedDuties += apportion(bill.goodsLines, vendorPartId, bill.billedDutiesMinor, true)
        billedOther += apportion(bill.goodsLines, vendorPartId, bill.billedOtherMinor, false)
      }

      return {
        freight: leg(accruedFreight, billedFreight),
        duties: leg(accruedDuties, billedDuties),
        otherBilledMinor: billedOther,
        receiptCount: receipts.length,
        landedLineCount,
        billCount: billIds.length,
      }
    },
    'Failed to read the landed cost for a vendor part',
    { organizationId, vendorPartId }
  )
}

/** The `vendor_bill`s whose own lines are linked to any of these order lines. */
async function loadGoodsBillsForOrderLines(
  db: Database,
  organizationId: string,
  purchaseOrderLineIds: readonly string[]
): Promise<string[]> {
  if (purchaseOrderLineIds.length === 0) return []
  const ctx = await systemFields(db, organizationId, 'vendor_bill_line', BILL_LINE_ATTRIBUTES)
  if (!ctx) return []
  const lines = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'vendor_bill_line_purchase_order_line', in: purchaseOrderLineIds },
  })
  const out = new Set<string>()
  for (const line of lines) {
    const billId = line.related('vendor_bill_line_vendor_bill')
    if (billId) out.add(billId)
  }
  return [...out]
}

/** This vendor part's share of one bill's landed amount, rounded to a minor unit. */
function apportion(
  goodsLines: readonly GoodsLine[],
  vendorPartId: string,
  amountMinor: number,
  byTariffRate: boolean
): number {
  if (amountMinor === 0) return 0
  const weight = (line: GoodsLine) =>
    byTariffRate ? line.valueMinor * line.tariffRate : line.valueMinor
  let total = 0
  let mine = 0
  for (const line of goodsLines) {
    const value = weight(line)
    total += value
    if (line.vendorPartId === vendorPartId) mine += value
  }
  if (total === 0) return 0
  return Math.round((amountMinor * mine) / total)
}
