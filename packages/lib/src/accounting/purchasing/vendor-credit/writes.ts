// packages/lib/src/accounting/purchasing/vendor-credit/writes.ts
//
// Creating, issuing and voiding a supplier's credit note. The buy-side mirror
// of `sales/credit-memos/writes.ts`, with the parties swapped.
//
// No permission checks here. The router asserts (docs/lib-module-guide.md §6).

import { type Database, database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { startOfDayInstant } from '@auxx/utils/calendar-day'
import { getEntityDefIdResolver } from '../../../cache'
import { BadRequestError } from '../../../errors'
import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollups,
} from '../../../field-hooks/post/purchase-order-line-rollups'
import { FieldValueService } from '../../../field-values/field-value-service'
import { readPartKinds } from '../../../inventory/builds/build-queries'
import { isServicePartKind } from '../../../inventory/costing/client'
import { batchRecalculateQoH } from '../../../inventory/costing/qoh'
import { UnifiedCrudHandler } from '../../../resources/crud'
import {
  type VendorCreditLineInput as BuilderLineInput,
  buildVendorCreditEntry,
} from '../../ledger/builders/vendor-credit'
import { withAccountingCommitLock } from '../../ledger/post/accounting-commit-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import {
  exportPostedEntry,
  type InTxPostResult,
  LEDGER_CURRENCY,
  previewEntry,
} from '../../ledger/post/post-entry'
import { exportInventoryMovement } from '../../ledger/post/post-inventory-movement'
import { isAccountingActive } from '../../ledger/setup/accounting-enabled'
import { readBookTimeZoneOrUtc, todayInBookTimeZone } from '../../ledger/setup/book-time-zone'
import type { EntryPreview, PostResult } from '../../ledger/types'
import { recomputeTotals } from '../../sales/totals/totals-hooks'
import { resolveGrniAccountId, resolvePurchasedServicesAccountId } from '../bill-intake/link'
import { postVendorCreditEntryInTx, reverseVendorCreditEntry } from './accounting'
import type { VendorCreditLineDraft } from './client'
import {
  loadVendorCreditLines,
  requireVendorCredit,
  sumVendorCreditApplications,
  sumVendorCreditRefunds,
  type VendorCreditLineRecord,
} from './reads'
import { settleVendorCredit, VENDOR_CREDIT_STATUS_BYPASS } from './settle'
import { planVendorCreditStockReturns, writeVendorCreditStockReturns } from './stock-return'

const logger = createScopedLogger('purchasing:vendor-credit')

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A writer for the credit's own status and date fields, past the lifecycle guard. */
async function statusWriter(
  db: Database,
  organizationId: string,
  userId: string
): Promise<{
  write: (creditId: string, values: Array<{ fieldId: string; value: unknown }>) => Promise<void>
}> {
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const service = new FieldValueService(
    organizationId,
    userId,
    db === database ? undefined : db,
    undefined,
    { bypassFieldGuards: VENDOR_CREDIT_STATUS_BYPASS }
  )
  return {
    write: async (creditId, values) => {
      await service.setValuesForEntity({
        recordId: toRecordId(resolveDefId('vendor_credit'), creditId),
        values,
      })
    },
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateVendorCreditInput {
  organizationId: string
  userId: string
  /** The `company` instance id the credit is from. Required. */
  vendorCompanyInstanceId: string
  /** The bill it credits, when there is one. */
  vendorBillInstanceId?: string
  purchaseOrderInstanceId?: string
  /** The supplier's own credit-note reference. */
  vendorReference?: string
  reason?: string
  note?: string
  /** `YYYY-MM-DD`. */
  issuedAt?: string
  /** Header tax as the supplier stated it, integer minor units. */
  taxTotal?: number
  lines: VendorCreditLineDraft[]
}

export interface CreateVendorCreditResult {
  vendorCreditInstanceId: string
}

function assertLineInputs(lines: readonly VendorCreditLineDraft[]): void {
  if (lines.length === 0) throw new BadRequestError('A vendor credit needs at least one line')
  lines.forEach((line, index) => {
    const row = index + 1
    if (!Number.isFinite(line.quantity) || line.quantity <= 0)
      throw new BadRequestError(`Line ${row}: quantity must be greater than zero`)
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0)
      throw new BadRequestError(
        `Line ${row}: unit price must be a whole number of cents, zero or more`
      )
    if (line.lineTotal !== undefined && !Number.isInteger(line.lineTotal))
      throw new BadRequestError(`Line ${row}: line total must be a whole number of cents`)
  })
}

/**
 * A draft vendor credit: a supplier, optionally the bill or order it credits,
 * and one or more coded lines.
 *
 * A credit raised against a PO-backed bill gets every uncoded line prefilled
 * with the org's resolved `grni` account, so the short-shipment entry
 * `Dr A/P / Cr GRNI` falls out of the one builder; an uncoded service line takes
 * the `purchased_services` account instead. The person may recode a line before issue.
 */
export async function createVendorCredit(
  db: Database,
  input: CreateVendorCreditInput
): Promise<CreateVendorCreditResult> {
  const { organizationId, userId, vendorCompanyInstanceId, lines } = input
  if (!vendorCompanyInstanceId) throw new BadRequestError('A vendor credit needs a vendor')
  assertLineInputs(lines)
  if (input.issuedAt !== undefined && !CALENDAR_DAY.test(input.issuedAt))
    throw new BadRequestError('issuedAt must be a calendar day (YYYY-MM-DD)')
  if (input.taxTotal !== undefined && (!Number.isInteger(input.taxTotal) || input.taxTotal < 0))
    throw new BadRequestError('Tax must be a whole number of cents, zero or more')

  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const header: Record<string, unknown> = {
    vendor_credit_status: 'draft',
    vendor_credit_vendor: toRecordId('company', vendorCompanyInstanceId),
  }
  if (input.vendorReference) header.vendor_credit_vendor_reference = input.vendorReference
  if (input.reason) header.vendor_credit_reason = input.reason
  if (input.note) header.vendor_credit_note = input.note
  if (input.taxTotal !== undefined) header.vendor_credit_tax_total = input.taxTotal
  if (input.vendorBillInstanceId)
    header.vendor_credit_bill = toRecordId('vendor_bill', input.vendorBillInstanceId)
  if (input.purchaseOrderInstanceId)
    header.vendor_credit_purchase_order = toRecordId(
      'purchase_order',
      input.purchaseOrderInstanceId
    )
  if (input.issuedAt) header.vendor_credit_issued_at = input.issuedAt

  const created = await handler.create('vendor_credit', header)
  const vendorCreditInstanceId = created.instance.id
  const creditRecordId = toRecordId('vendor_credit', vendorCreditInstanceId)

  // The prefill is resolved ONCE, and only when it can be needed. `null` when
  // the org has not mapped the role - a line then arrives uncoded and the
  // issue refuses naming it, which is the right failure: a guessed account
  // balances perfectly and is invisible.
  const uncoded = lines.filter((line) => !line.glAccountInstanceId)
  const partKinds = await readPartKinds(
    db,
    organizationId,
    uncoded.map((line) => line.partInstanceId).filter((id): id is string => !!id)
  )
  // A service was never received, so it has no GRNI to credit back (107-D10); it
  // takes `purchased_services` instead (107 §9).
  const isService = (line: VendorCreditLineDraft) =>
    !!line.partInstanceId && isServicePartKind(partKinds.get(line.partInstanceId))
  const [grniAccountId, servicesAccountId] = await Promise.all([
    input.purchaseOrderInstanceId && uncoded.some((line) => !isService(line))
      ? resolveGrniAccountId(db, organizationId)
      : null,
    uncoded.some(isService) ? resolvePurchasedServicesAccountId(db, organizationId) : null,
  ])

  const items = lines.map((line, index) => {
    const values: Record<string, unknown> = {
      vendor_credit_line_vendor_credit: creditRecordId,
      vendor_credit_line_quantity: line.quantity,
      vendor_credit_line_unit_price: line.unitPrice,
      vendor_credit_line_line_total: line.lineTotal ?? Math.round(line.quantity * line.unitPrice),
      vendor_credit_line_sort_order: index,
    }
    if (line.description) values.vendor_credit_line_description = line.description
    const glAccountId =
      line.glAccountInstanceId ?? (isService(line) ? servicesAccountId : grniAccountId)
    if (glAccountId) values.vendor_credit_line_gl_account = glAccountId
    if (line.partInstanceId)
      values.vendor_credit_line_part = toRecordId('part', line.partInstanceId)
    if (line.purchaseOrderLineInstanceId)
      values.vendor_credit_line_purchase_order_line = toRecordId(
        'purchase_order_line',
        line.purchaseOrderLineInstanceId
      )
    if (line.returnsStock) values.vendor_credit_line_returns_stock = true
    return values
  })

  const { errors } = await handler.bulkCreate('vendor_credit_line', items)
  if (errors.length > 0) {
    const first = errors[0]!
    throw new BadRequestError(`Line ${first.index + 1} could not be created: ${first.error}`, {
      vendorCreditInstanceId,
    })
  }

  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'vendor_credit',
    documentInstanceId: vendorCreditInstanceId,
    db,
  })

  return { vendorCreditInstanceId }
}

// ─── Issue ──────────────────────────────────────────────────────────────────

export interface IssueVendorCreditInput {
  organizationId: string
  userId: string
  vendorCreditInstanceId: string
  /** `YYYY-MM-DD`. Defaults to the stored date, then to today in the book zone. */
  issuedAt?: string
}

export interface IssueVendorCreditResult {
  postingId: string | null
  docNumber: string | null
  status: 'issued' | 'settled'
}

/** Refuse an issue that cannot be made, resolve its date, and build the entry. */
async function resolveIssue(
  db: Database,
  input: IssueVendorCreditInput,
  options: { buildEntry: boolean }
) {
  const { organizationId, vendorCreditInstanceId } = input
  const credit = await requireVendorCredit(db, organizationId, vendorCreditInstanceId)

  if (credit.status !== 'draft')
    throw new BadRequestError(
      credit.status === 'void'
        ? 'A void vendor credit cannot be issued'
        : 'This vendor credit has already been issued',
      { vendorCreditInstanceId, status: credit.status }
    )
  if (!credit.number)
    throw new BadRequestError('This vendor credit has no number to key its entry on', {
      vendorCreditInstanceId,
    })

  if (input.issuedAt !== undefined && !CALENDAR_DAY.test(input.issuedAt))
    throw new BadRequestError('issuedAt must be a calendar day (YYYY-MM-DD)')
  const issuedAt = input.issuedAt ?? credit.issuedAt ?? (await todayInBookTimeZone(organizationId))

  const lines = await loadVendorCreditLines(db, organizationId, credit.lineIds)
  // An uncoded service line posts to `purchased_services` rather than refusing (107 §9).
  const partKinds = options.buildEntry
    ? await readPartKinds(
        db,
        organizationId,
        lines.flatMap((line) =>
          !line.glAccountId && line.partInstanceId ? [line.partInstanceId] : []
        )
      )
    : new Map<string, string>()

  const built = options.buildEntry
    ? buildVendorCreditEntry({
        vendorCreditId: vendorCreditInstanceId,
        number: credit.number,
        issuedAt,
        ledgerCurrency: LEDGER_CURRENCY,
        total: credit.totalMinor,
        vendorCompanyInstanceId: credit.vendorCompanyInstanceId,
        lines: lines.map(
          (line): BuilderLineInput => ({
            lineId: line.id,
            glAccountId: line.glAccountId,
            amount: line.lineTotalMinor,
            description: line.description,
            service: !!line.partInstanceId && isServicePartKind(partKinds.get(line.partInstanceId)),
          })
        ),
      })
    : undefined

  return { credit, lines, issuedAt, built }
}

/** Preview the issue entry without writing anything. */
export async function previewIssueVendorCredit(
  db: Database,
  input: IssueVendorCreditInput
): Promise<EntryPreview> {
  const { built } = await resolveIssue(db, input, { buildEntry: true })
  return previewEntry(db, { organizationId: input.organizationId, entry: built!.entry })
}

/**
 * Issue a draft: validate, post `Dr accounts_payable / Cr <each line>`, flip to
 * `issued`, then settle.
 *
 * The ledger goes FIRST and a refused post refuses the issue, naming the
 * reason. Nothing has been written at that point, so the credit stays a draft.
 */
export async function issueVendorCredit(
  db: Database,
  input: IssueVendorCreditInput
): Promise<IssueVendorCreditResult> {
  const { organizationId, userId, vendorCreditInstanceId } = input

  // The mirrors first, so what is stored is what posts.
  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'vendor_credit',
    documentInstanceId: vendorCreditInstanceId,
    db,
  })

  const accountingEnabled = await isAccountingActive(organizationId)
  const { credit, lines, issuedAt, built } = await resolveIssue(db, input, {
    buildEntry: accountingEnabled,
  })

  // 73 §8.2. Resolved BEFORE anything is written, so a flagged line with no
  // part, no quantity or no standard refuses the issue by name with the credit
  // still a draft — the same contract the multi-line receipt keeps.
  const returns = await planVendorCreditStockReturns(db, organizationId, lines)
  const occurredAt = startOfDayInstant(issuedAt, await readBookTimeZoneOrUtc(organizationId))

  // One transaction for the whole supplier return: the money entry, the goods
  // leaving, and the inventory entry that values them. Half of it committed is a
  // credit whose stock never moved, or stock that left for no credit.
  const { post, stock } = await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)

    let post: InTxPostResult | PostResult = { status: 'not_enabled' as const }
    if (accountingEnabled) {
      post = await postVendorCreditEntryInTx(tx, {
        organizationId,
        vendorCreditInstanceId,
        vendorCompanyInstanceId: credit.vendorCompanyInstanceId,
        vendorBillInstanceId: credit.vendorBillInstanceId,
        entry: built!.entry,
        actorUserId: userId,
        memo: `Vendor credit ${credit.number} issued`,
      })
    }
    if (!didLedgerAccept(post) && post.status !== 'not_enabled') {
      // Inside the transaction, so the refusal takes the movements with it.
      throw new BadRequestError(
        'This vendor credit could not be posted to the general ledger' +
          `${post.error ? `: ${post.error}` : ` (${post.status})`}`,
        { vendorCreditInstanceId, status: post.status }
      )
    }

    const stock = await writeVendorCreditStockReturns(tx, {
      organizationId,
      userId,
      vendorCreditInstanceId,
      number: credit.number,
      occurredAt,
      returns,
    })
    return { post, stock }
  })

  // After the commit, never inside it: a provider round trip holds the claim's
  // index tuple for the length of an HTTP call.
  if ('pendingExport' in post && post.pendingExport) await exportPostedEntry(db, post.pendingExport)
  await exportInventoryMovement(db, stock.post)
  if (stock.affectedPartIds.length > 0) {
    await batchRecalculateQoH(organizationId, stock.affectedPartIds)
  }
  await settleReturnRollups(organizationId, {
    received: stock.purchaseOrderLineIds,
    billed: purchaseOrderLineIdsOf(lines),
  })

  const writes: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'vendor_credit_status', value: 'issued' },
  ]
  if (credit.issuedAt !== issuedAt)
    writes.push({ fieldId: 'vendor_credit_issued_at', value: issuedAt })
  const writer = await statusWriter(db, organizationId, userId)
  await writer.write(vendorCreditInstanceId, writes)

  const settled = await settleVendorCredit(db, {
    organizationId,
    userId,
    vendorCreditInstanceId,
  })

  logger.info('Issued a vendor credit', {
    organizationId,
    vendorCreditInstanceId,
    number: credit.number,
    status: post.status,
  })

  return {
    postingId: post.glPostingId ?? null,
    docNumber: post.docNumber ?? null,
    status: settled.status === 'settled' ? 'settled' : 'issued',
  }
}

// ─── Void ───────────────────────────────────────────────────────────────────

export interface VendorCreditLifecycleInput {
  organizationId: string
  userId: string
  vendorCreditInstanceId: string
}

/**
 * Void a credit: reverse its issue entry, then set `void`. Refused once
 * anything has been applied or refunded (unapply first), and the reversal goes
 * FIRST so a refused reversal refuses the void with the credit as it was.
 */
export async function voidVendorCredit(
  db: Database,
  input: VendorCreditLifecycleInput
): Promise<void> {
  const { organizationId, userId, vendorCreditInstanceId } = input
  const credit = await requireVendorCredit(db, organizationId, vendorCreditInstanceId)

  if (credit.status === 'void')
    throw new BadRequestError('This vendor credit is already void', { vendorCreditInstanceId })
  if (credit.status === 'draft')
    throw new BadRequestError('Discard a draft vendor credit instead of voiding it', {
      vendorCreditInstanceId,
    })

  const [applied, refunded] = await Promise.all([
    sumVendorCreditApplications(db, organizationId, vendorCreditInstanceId),
    sumVendorCreditRefunds(db, organizationId, vendorCreditInstanceId),
  ])
  if (applied > 0)
    throw new BadRequestError('Unapply this vendor credit from its bills before voiding it', {
      vendorCreditInstanceId,
      appliedMinor: String(applied),
    })
  if (refunded > 0)
    throw new BadRequestError(
      'The supplier has already refunded against this credit, so it cannot be voided',
      { vendorCreditInstanceId, refundedMinor: String(refunded) }
    )

  const reversal = await reverseVendorCreditEntry(db, {
    organizationId,
    vendorCreditInstanceId,
    actorUserId: userId,
    memo: `Vendor credit ${credit.number} voided`,
  })
  if (reversal && !didLedgerAccept(reversal)) {
    throw new BadRequestError(
      'This vendor credit has a general ledger entry that could not be reversed' +
        `${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}. Voiding it would ` +
        'leave the credit in the books with no document behind it.',
      { vendorCreditInstanceId, status: reversal.status }
    )
  }

  const writer = await statusWriter(db, organizationId, userId)
  await writer.write(vendorCreditInstanceId, [{ fieldId: 'vendor_credit_status', value: 'void' }])

  // The billed roll-up nets this credit's lines and skips a VOID credit's
  // (73 §8.2), so the order lines have to be re-summed now that it is one.
  const lines = await loadVendorCreditLines(db, organizationId, credit.lineIds)
  await settleReturnRollups(organizationId, { received: [], billed: purchaseOrderLineIdsOf(lines) })
}

/** The distinct order lines a credit's lines point at. */
function purchaseOrderLineIdsOf(lines: readonly VendorCreditLineRecord[]): string[] {
  return [
    ...new Set(
      lines
        .map((line) => line.purchaseOrderLineInstanceId)
        .filter((id): id is string => id !== null)
    ),
  ]
}

/**
 * Re-SUM the order lines a credit touched, now that its lines are committed.
 *
 * The lifecycle rules behind the credit-line writes do the same work; this gets
 * there first so the match sees the netted figure in the same breath as the
 * issue. A failure is logged and swallowed — the credit is the primary fact and
 * is already committed, and the rules are the fallback.
 */
async function settleReturnRollups(
  organizationId: string,
  lines: { received: readonly string[]; billed: readonly string[] }
): Promise<void> {
  const passes = [
    { ids: lines.received, spec: PURCHASE_ORDER_LINE_ROLLUPS.received },
    { ids: lines.billed, spec: PURCHASE_ORDER_LINE_ROLLUPS.billed },
  ]
  for (const { ids, spec } of passes) {
    if (ids.length === 0) continue
    try {
      await recalculatePurchaseOrderLineRollups(organizationId, [...ids], spec)
    } catch (error) {
      logger.error('Failed to settle purchase order line roll-ups after a vendor credit', {
        organizationId,
        target: spec.targetAttr,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
