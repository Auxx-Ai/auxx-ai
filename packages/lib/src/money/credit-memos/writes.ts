// packages/lib/src/money/credit-memos/writes.ts
//
// The credit memo's lifecycle writers: create (from an invoice or from
// scratch), issue, preview the issue entry, void, discard.
//
// Same convention as `money/invoices/write-off.ts`: `db` first, an input object
// carrying `organizationId` and `userId`, `UnifiedCrudHandler` for entity
// writes, `AuxxError` subclasses thrown directly rather than a `neverthrow`
// `Result` (the money module's local style for a document action). No
// permission checks here - the router asserts (`docs/lib-module-guide.md` §6).
//
// plans/accounting/tasks/10-credit-memos.md sections 2.4, 3.1, 5.1 and 10.7.

import { type Database, database } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { getEntityDefIdResolver } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { FieldValueService } from '../../field-values/field-value-service'
import { matchGatewayRoute, toGatewayRoutes } from '../../payment-gateways/client'
import { listPaymentGateways } from '../../payment-gateways/reads'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  type BuiltCreditMemoEntry,
  buildCreditMemoEntry,
  CREDIT_MEMO_POSTING_TYPE,
  CREDIT_MEMO_SOURCE_TYPE,
  type CreditMemoSettlement as CreditMemoSettlementLeg,
} from '../../postings/build-credit-memo-entry'
import { isExpectedPostOutcome } from '../../postings/ledger-accepted'
import { listPostingsForSource } from '../../postings/list-postings'
import { resolvePeriodLock } from '../../postings/period-lock'
import { periodKeyForDate } from '../../postings/periods'
import { LEDGER_CURRENCY, postEntry, previewEntry } from '../../postings/post-entry'
import { reverseEntry } from '../../postings/reverse-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { EntryPreview, PostResult } from '../../postings/types'
import { UnifiedCrudHandler } from '../../resources/crud'
import { getOrganizationSetting } from '../../settings/settings-service'
import { roundCents } from '../totals'
import { recomputeTotals } from '../totals-hooks'
import type { CreditMemoLineInput, CreditMemoReason, CreditMemoSource } from './client'
import {
  type CreditMemoLineRecord,
  type CreditMemoRecord,
  type InvoiceLineForCredit,
  loadCreditMemoLines,
  loadInvoiceForCredit,
  loadInvoiceLinesForCredit,
  orderHadFulfillmentBefore,
  readOrderGateways,
  requireCreditMemo,
  sumCreditMemoApplications,
  sumSucceededCreditMemoRefunds,
} from './reads'
import { CREDIT_MEMO_STATUS_BYPASS, settleCreditMemo } from './settle'

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/

/** Today, in the org's own book time zone - falls back to UTC while setup is incomplete. */
async function todayInBookTimeZone(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  const bookTimeZone = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'UTC'
  return periodKeyForDate(new Date(), 'day', bookTimeZone)
}

/** The org's document currency, or the ledger's when the setting is blank. */
async function organizationCurrency(organizationId: string): Promise<string> {
  const raw = await getOrganizationSetting({ organizationId, key: 'organization.currency' })
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : LEDGER_CURRENCY
}

/**
 * A calendar day written into a DATETIME field.
 *
 * Noon UTC rather than midnight, so the instant renders as the SAME calendar day
 * in every zone from UTC-12 to UTC+11. The ledger reads only the day back
 * (`reads.ts` slices it), so the hour carries no meaning beyond display.
 */
function calendarDayToInstant(day: string): string {
  return `${day}T12:00:00.000Z`
}

/** A writer for the fields the status wall protects. Mirrors `settle.ts`'s. */
async function statusWriter(
  db: Database,
  organizationId: string,
  userId: string
): Promise<{
  write: (creditMemoId: string, values: Array<{ fieldId: string; value: unknown }>) => Promise<void>
}> {
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  const service = new FieldValueService(
    organizationId,
    userId,
    db === database ? undefined : db,
    undefined,
    { bypassFieldGuards: CREDIT_MEMO_STATUS_BYPASS }
  )
  return {
    write: async (creditMemoId, values) => {
      await service.setValuesForEntity({
        recordId: toRecordId(resolveDefId('credit_memo'), creditMemoId),
        values,
      })
    },
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreateCreditMemoInput {
  organizationId: string
  userId: string
  contactInstanceId: string
  reason?: CreditMemoReason
  note?: string
  invoiceInstanceId?: string
  orderInstanceId?: string
  /** Defaults to `native`. The connector passes `channel`. */
  source?: CreditMemoSource
  /** `YYYY-MM-DD`. A channel memo carries the refund's own date; a native one is dated on issue. */
  issuedAt?: string
  lines: CreditMemoLineInput[]
}

export interface CreateCreditMemoResult {
  creditMemoInstanceId: string
}

/** Refuse a line set the totals engine could not sum honestly. */
function assertLineInputs(lines: readonly CreditMemoLineInput[]): void {
  if (lines.length === 0) {
    throw new BadRequestError('A credit memo needs at least one line')
  }
  lines.forEach((line, index) => {
    const row = index + 1
    if (!Number.isFinite(line.qty) || line.qty <= 0) {
      throw new BadRequestError(`Line ${row}: quantity must be greater than zero`)
    }
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
      throw new BadRequestError(
        `Line ${row}: unit price must be a whole number of cents, zero or more`
      )
    }
    if (line.taxTotal !== undefined && (!Number.isInteger(line.taxTotal) || line.taxTotal < 0)) {
      throw new BadRequestError(`Line ${row}: tax must be a whole number of cents, zero or more`)
    }
  })
}

/**
 * A draft credit memo from scratch: a contact, optionally the invoice or order
 * it credits, and one or more lines. A concession line has no line item.
 *
 * Lines are written through the ordinary CRUD door, so the number hook
 * allocates `CM-0001` on the memo and the totals engine sums the lines onto it;
 * the totals are then recomputed synchronously here rather than left to the
 * reconciler's drain, so the caller reads back a memo whose totals already
 * match its lines.
 */
export async function createCreditMemo(
  db: Database,
  input: CreateCreditMemoInput
): Promise<CreateCreditMemoResult> {
  const { organizationId, userId, contactInstanceId, lines } = input
  if (!contactInstanceId) {
    throw new BadRequestError('A credit memo needs a contact')
  }
  assertLineInputs(lines)
  if (input.issuedAt !== undefined && !CALENDAR_DAY.test(input.issuedAt)) {
    throw new BadRequestError('issuedAt must be a calendar day (YYYY-MM-DD)')
  }

  const handler = new UnifiedCrudHandler(organizationId, userId, db)

  const header: Record<string, unknown> = {
    credit_memo_status: 'draft',
    credit_memo_source: input.source ?? 'native',
    credit_memo_contact: toRecordId('contact', contactInstanceId),
  }
  if (input.reason) header.credit_memo_reason = input.reason
  if (input.note) header.credit_memo_note = input.note
  if (input.invoiceInstanceId) {
    header.credit_memo_invoice = toRecordId('invoice', input.invoiceInstanceId)
  }
  if (input.orderInstanceId) header.credit_memo_order = toRecordId('order', input.orderInstanceId)
  if (input.issuedAt) header.credit_memo_issued_at = calendarDayToInstant(input.issuedAt)

  const created = await handler.create('credit_memo', header)
  const creditMemoInstanceId = created.instance.id
  const memoRecordId = toRecordId('credit_memo', creditMemoInstanceId)

  const items = lines.map((line, index) => {
    const values: Record<string, unknown> = {
      credit_memo_line_credit_memo: memoRecordId,
      credit_memo_line_qty: line.qty,
      credit_memo_line_unit_price: line.unitPrice,
      // The line's subtotal is the FACT the totals engine sums (never
      // `qty * unit_price` re-multiplied at the parent); for a native line the
      // two agree by construction.
      credit_memo_line_subtotal: roundCents(line.qty * line.unitPrice),
      credit_memo_line_sort_order: index,
    }
    if (line.description) values.credit_memo_line_description = line.description
    if (line.taxTotal !== undefined) values.credit_memo_line_tax_total = line.taxTotal
    if (line.disposition) values.credit_memo_line_disposition = line.disposition
    if (line.lineItemInstanceId) {
      values.credit_memo_line_line_item = toRecordId('line_item', line.lineItemInstanceId)
    }
    return values
  })
  const { errors } = await handler.bulkCreate('credit_memo_line', items)
  if (errors.length > 0) {
    const first = errors[0]!
    throw new BadRequestError(`Line ${first.index + 1} could not be created: ${first.error}`, {
      creditMemoInstanceId,
    })
  }

  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'credit_memo',
    documentInstanceId: creditMemoInstanceId,
    db,
  })

  return { creditMemoInstanceId }
}

export interface CreateCreditMemoFromInvoiceInput {
  organizationId: string
  userId: string
  invoiceInstanceId: string
  /** The invoice's `line_item` ids to credit. Every line when omitted. */
  lineItemIds?: string[]
  reason?: CreditMemoReason
  note?: string
}

/**
 * Each invoice line's share of the invoice's tax, integer minor units, keyed by
 * line id.
 *
 * A line that carries its own `line_item_tax_total` (a connector-transcribed
 * invoice) is taken verbatim. Otherwise the invoice stores tax only as a header
 * total derived from a rate, so the header's `invoice_tax_total` is prorated
 * across the TAXABLE lines by line total, with the rounding remainder handed to
 * the largest fractional shares so the shares of every line sum to the header
 * exactly. Prorating is the one honest option here: there is no per-line tax to
 * transcribe, and recomputing from the rate would be a second implementation of
 * `computeDocumentTotals` free to drift from the stored total.
 */
export function shareInvoiceTaxAcrossLines(
  lines: readonly InvoiceLineForCredit[],
  invoiceTaxTotalMinor: number
): Map<string, number> {
  const shares = new Map<string, number>()
  const toProrate = lines.filter(
    (line) => line.taxTotalMinor == null && line.taxable && (line.lineTotalMinor ?? 0) > 0
  )
  for (const line of lines) {
    if (line.taxTotalMinor != null) shares.set(line.id, Math.round(line.taxTotalMinor))
  }
  const taxableBase = toProrate.reduce((sum, line) => sum + (line.lineTotalMinor ?? 0), 0)
  if (taxableBase <= 0 || invoiceTaxTotalMinor <= 0) {
    for (const line of toProrate) shares.set(line.id, 0)
    return shares
  }

  const raw = toProrate.map((line) => ({
    id: line.id,
    exact: (invoiceTaxTotalMinor * (line.lineTotalMinor ?? 0)) / taxableBase,
  }))
  let allocated = 0
  for (const entry of raw) {
    const floored = Math.floor(entry.exact)
    shares.set(entry.id, floored)
    allocated += floored
  }
  let remainder = Math.round(invoiceTaxTotalMinor) - allocated
  const byFraction = [...raw].sort(
    (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact))
  )
  for (const entry of byFraction) {
    if (remainder <= 0) break
    shares.set(entry.id, (shares.get(entry.id) ?? 0) + 1)
    remainder -= 1
  }
  return shares
}

/**
 * A draft credit memo against an invoice: `source: native`, the invoice's
 * contact, one line per invoice line item (all of them by default) carrying the
 * line's quantity, unit price, subtotal and tax share.
 *
 * Only a SENT invoice can be credited (`sent`, `partially_paid`, `paid`): a
 * draft is edited instead, and a void or written-off invoice has no receivable
 * left to reduce.
 */
export async function createCreditMemoFromInvoice(
  db: Database,
  input: CreateCreditMemoFromInvoiceInput
): Promise<CreateCreditMemoResult> {
  const { organizationId, userId, invoiceInstanceId } = input

  const invoice = await loadInvoiceForCredit(db, organizationId, invoiceInstanceId)
  if (!invoice) throw new NotFoundError('Invoice not found', { invoiceInstanceId })
  if (invoice.status === 'draft') {
    throw new BadRequestError('Edit a draft invoice instead of crediting it', {
      invoiceInstanceId,
    })
  }
  if (invoice.status === 'void' || invoice.status === 'written_off') {
    throw new BadRequestError(
      `Cannot credit a ${invoice.status.replace(/_/g, ' ')} invoice - it has no receivable left`,
      { invoiceInstanceId }
    )
  }
  if (!invoice.contactInstanceId) {
    throw new BadRequestError('This invoice has no contact, and a credit memo needs one', {
      invoiceInstanceId,
    })
  }

  const allLines = await loadInvoiceLinesForCredit(db, organizationId, invoice.lineIds)
  const taxShares = shareInvoiceTaxAcrossLines(allLines, invoice.taxTotalMinor)

  let selected = allLines
  if (input.lineItemIds) {
    const wanted = new Set(input.lineItemIds)
    selected = allLines.filter((line) => wanted.has(line.id))
    const missing = input.lineItemIds.filter((id) => !allLines.some((line) => line.id === id))
    if (missing.length > 0) {
      throw new BadRequestError(
        `${missing.length} of the selected lines are not on invoice ${invoice.number}`,
        { invoiceInstanceId, missing: missing.join(',') }
      )
    }
  }
  const priced = selected.filter((line) => line.unitPriceMinor != null && line.qty > 0)
  if (priced.length === 0) {
    throw new BadRequestError('This invoice has no priced lines to credit', { invoiceInstanceId })
  }

  return createCreditMemo(db, {
    organizationId,
    userId,
    contactInstanceId: invoice.contactInstanceId,
    invoiceInstanceId,
    reason: input.reason,
    note: input.note,
    source: 'native',
    lines: priced.map((line) => ({
      description: line.name,
      qty: line.qty,
      unitPrice: Math.round(line.unitPriceMinor ?? 0),
      taxTotal: taxShares.get(line.id) ?? 0,
      lineItemInstanceId: line.id,
    })),
  })
}

// ─── Issue ──────────────────────────────────────────────────────────────────

export interface IssueCreditMemoInput {
  organizationId: string
  userId: string
  creditMemoInstanceId: string
  /** `YYYY-MM-DD`. Defaults to the stored date, then to today in the book time zone. */
  issuedAt?: string
}

export interface IssueCreditMemoResult {
  /** The `GlPosting` row, or `null` when the ledger is not connected and claimed nothing. */
  postingId: string | null
  docNumber: string | null
  status: 'issued' | 'settled'
}

/** Everything the issue entry is built from, shared by issue and preview. */
interface ResolvedIssue {
  memo: CreditMemoRecord
  lines: CreditMemoLineRecord[]
  issuedAt: string
  /**
   * Absent when the caller asked to skip it (`resolveIssue`'s `buildEntry: false`)
   * because the org has never enabled accounting - see the call site in
   * {@link issueCreditMemo}. {@link previewIssueCreditMemo} always asks for it.
   */
  built: BuiltCreditMemoEntry | undefined
}

/**
 * Refuse an issue that cannot be made, resolve its date and both legs, and -
 * unless the caller says otherwise - build the entry. Shared by
 * {@link issueCreditMemo} and {@link previewIssueCreditMemo} so the two can
 * never disagree about what is refusable before the ledger is asked.
 *
 * The totals the entry carries are summed from the LINES here, not read off
 * the memo's mirrors, so a preview of a draft whose reconciler drain has not
 * run yet still shows the right numbers; `issueCreditMemo` recomputes the
 * mirrors before calling this so the stored totals match what posts.
 *
 * `buildEntry: false` skips `orderHadFulfillmentBefore` (a read that exists
 * only to decide the builder's `reverseRevenue`) and the builder call itself -
 * {@link issueCreditMemo} passes it when the org has never turned accounting
 * on (task 17 section 3), so a credit memo can still issue with none of that
 * work done and no ledger-specific refusal (a foreign currency, say) reachable
 * for an org this module does nothing for.
 */
async function resolveIssue(
  db: Database,
  input: IssueCreditMemoInput,
  options: { buildEntry: boolean } = { buildEntry: true }
): Promise<ResolvedIssue> {
  const { organizationId, creditMemoInstanceId } = input
  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)

  if (memo.status !== 'draft') {
    throw new BadRequestError(
      memo.status === 'void'
        ? 'This credit memo is void and cannot be issued'
        : `This credit memo is already ${memo.status}`,
      { creditMemoInstanceId, status: memo.status }
    )
  }
  if (!memo.contactInstanceId) {
    throw new BadRequestError('A credit memo needs a contact before it can be issued', {
      creditMemoInstanceId,
    })
  }
  if (!memo.number || memo.number.trim().length === 0) {
    throw new BadRequestError(
      'This credit memo has no number yet, and the issue entry keys its document number on it',
      { creditMemoInstanceId }
    )
  }
  const lines = await loadCreditMemoLines(db, organizationId, memo.lineIds)
  if (lines.length === 0) {
    throw new BadRequestError('A credit memo needs at least one line before it can be issued', {
      creditMemoInstanceId,
    })
  }

  if (input.issuedAt !== undefined && !CALENDAR_DAY.test(input.issuedAt)) {
    throw new BadRequestError('issuedAt must be a calendar day (YYYY-MM-DD)')
  }
  let issuedAt = input.issuedAt ?? memo.issuedAt
  if (!issuedAt) {
    if (memo.source === 'channel') {
      // The channel's own date is the accounting date, never ingest time and
      // never today (section 2.1). A channel memo without one is a connector
      // defect, not something to paper over with the clock.
      throw new UnprocessableEntityError(
        'This channel credit memo carries no refund date, so it cannot be dated in the ledger',
        { creditMemoInstanceId }
      )
    }
    issuedAt = await todayInBookTimeZone(organizationId)
  }

  // Summed from the lines: the tax is transcribed line by line and never
  // recomputed from a rate (section 3.1), and the subtotal is the sum of the
  // line subtotals, never `qty * unit_price` re-multiplied at the parent.
  const subtotal = roundCents(lines.reduce((sum, line) => sum + line.subtotalMinor, 0))
  const taxTotal = roundCents(lines.reduce((sum, line) => sum + (line.taxTotalMinor ?? 0), 0))
  const total = subtotal + taxTotal
  if (total <= 0) {
    throw new BadRequestError('A credit memo must credit more than zero before it can be issued', {
      creditMemoInstanceId,
    })
  }

  if (!options.buildEntry) {
    return { memo, lines, issuedAt, built: undefined }
  }

  // Native: always reverses revenue, because it exists only where an invoice
  // was issued. Channel: only when the order shipped before the memo's date,
  // because `build-fulfillment-entry.ts` recognised nothing otherwise.
  const reverseRevenue =
    memo.source === 'channel'
      ? memo.orderInstanceId
        ? await orderHadFulfillmentBefore(db, organizationId, memo.orderInstanceId, issuedAt)
        : false
      : true

  // The channel money leg: what Shopify already paid back, mirrored out of
  // clearing (section 3.2). A native memo's money moves as a
  // `PaymentTransaction` and posts through the payment builder instead.
  //
  // 🛑 It must come out of the account the SALE debited. A `payment_gateway`
  // record routes a non-card rail to its own clearing account by id, so an
  // Affirm sale debits `1210` while `clearing_card` is `1200`; crediting the
  // role here would leave `1210` overstated forever in an entry that balances.
  // Same matcher the fulfillment debit fork uses, so the two cannot drift.
  const settlement: CreditMemoSettlementLeg | undefined =
    memo.source === 'channel' && memo.amountRefundedMinor > 0
      ? {
          ...(await resolveSettlementAccount(db, organizationId, memo.orderInstanceId)),
          amount: Math.round(memo.amountRefundedMinor),
        }
      : undefined

  const currency = await organizationCurrency(organizationId)
  const built = buildCreditMemoEntry({
    creditMemoId: creditMemoInstanceId,
    number: memo.number,
    issuedAt,
    currency,
    ledgerCurrency: LEDGER_CURRENCY,
    subtotal,
    taxTotal,
    total,
    reverseRevenue,
    settlement,
    contactInstanceId: memo.contactInstanceId,
    memo: `Credit memo ${memo.number} issued`,
  })

  return { memo, lines, issuedAt, built }
}

/**
 * Where a channel refund comes back out of: a `payment_gateway` record's own
 * clearing account, or `clearing_card`.
 *
 * The mirror of `resolveFulfillmentDebit`'s gateway branch, and deliberately
 * only that branch - a refund asks "which account did this order's money land
 * in", never "is this order paid", so the financial-status fork has no part in
 * it. `matchGatewayRoute` is shared with the sale side so one gateway cannot
 * resolve two ways.
 *
 * Falls back to the role on every uncertainty - no order, no gateway, no
 * matching record, two records claiming one handle - because `clearing_card` is
 * where a wrong answer fails to reconcile visibly rather than quietly.
 *
 * ⚠️ An order with TWO gateways takes the role too. The fulfillment fork
 * excludes that shipment outright as `gateway-ambiguous`; a refund cannot
 * refuse (the money has already moved), so it lands in the account a person
 * reconciling the rail is looking at anyway.
 */
async function resolveSettlementAccount(
  db: Database,
  organizationId: string,
  orderInstanceId: string | null
): Promise<{ role: 'clearing_card' } | { glAccountId: string }> {
  const fallback = { role: 'clearing_card' } as const
  if (!orderInstanceId) return fallback

  const gateways = await readOrderGateways(db, organizationId, orderInstanceId)
  if (gateways.length !== 1) return fallback

  const result = await listPaymentGateways(db, organizationId)
  const routes = result.isOk() ? toGatewayRoutes(result.value) : []
  const glAccountId = matchGatewayRoute(gateways[0] as string, routes)
  return glAccountId ? { glAccountId } : fallback
}

/**
 * What issuing this memo WOULD post, resolved against the org's own chart.
 * Persists nothing - the drawer's live `EntryJournal`/`EntryBlockers` preview,
 * the same shape `previewWriteOffInvoice` returns.
 */
export async function previewIssueCreditMemo(
  db: Database,
  input: IssueCreditMemoInput
): Promise<EntryPreview> {
  const { organizationId } = input
  // Always asks for the entry - a preview with nothing to preview is not a
  // preview - so `built` is always present here.
  const { built } = await resolveIssue(db, input, { buildEntry: true })
  const lock = await resolvePeriodLock(organizationId)
  return previewEntry(db, { organizationId, entry: built!.entry, lock })
}

/**
 * Issue a draft: validate, post the section 3.1 entry, flip to `issued`, then
 * settle so a channel memo lands `settled` in the same call.
 *
 * ```
 *   Dr revenue_returns_allowances   subtotal
 *   Dr sales_tax_payable            tax
 *       Cr accounts_receivable        total
 * ```
 *
 * The ledger goes FIRST and a refused post refuses the issue, naming the
 * reason: a locked period, an unmapped role. Nothing has been written at that
 * point, so the memo stays a draft. The claim is keyed on the memo number, so a
 * retry converges to `already_posted` and still flips the status.
 */
export async function issueCreditMemo(
  db: Database,
  input: IssueCreditMemoInput
): Promise<IssueCreditMemoResult> {
  const { organizationId, userId, creditMemoInstanceId } = input

  // The mirrors first, so what is stored is what posts. `resolveIssue` sums the
  // lines itself, and the builder asserts `total = subtotal + tax`, so a stale
  // mirror could only ever disagree with the document on screen, never with
  // the entry.
  await recomputeTotals({
    organizationId,
    userId,
    documentType: 'credit_memo',
    documentInstanceId: creditMemoInstanceId,
    db,
  })

  // The org's own accounting-off case is checked FIRST, and passed into
  // `resolveIssue` so it skips the read and the build that exist only to post
  // an entry (task 17 section 3) - a credit memo issues on an org that has
  // never turned accounting on exactly as it would on one that has.
  const accountingEnabled = await isAccountingEnabled(db, organizationId)
  const { memo, issuedAt, built } = await resolveIssue(db, input, { buildEntry: accountingEnabled })

  let post: PostResult
  if (accountingEnabled) {
    const lock = await resolvePeriodLock(organizationId)
    post = await postEntry(db, {
      organizationId,
      entry: built!.entry,
      actorUserId: userId,
      lock,
      memo: `Credit memo ${memo.number} issued`,
    })
  } else {
    post = { status: 'not_enabled' }
  }
  if (!isExpectedPostOutcome(post)) {
    throw new BadRequestError(
      `This credit memo could not be posted to the general ledger` +
        `${post.error ? `: ${post.error}` : ` (${post.status})`}`,
      { creditMemoInstanceId, status: post.status }
    )
  }

  const writes: Array<{ fieldId: string; value: unknown }> = [
    { fieldId: 'credit_memo_status', value: 'issued' },
  ]
  if (memo.issuedAt !== issuedAt) {
    writes.push({ fieldId: 'credit_memo_issued_at', value: calendarDayToInstant(issuedAt) })
  }
  const writer = await statusWriter(db, organizationId, userId)
  await writer.write(creditMemoInstanceId, writes)

  const settled = await settleCreditMemo(db, { organizationId, userId, creditMemoInstanceId })

  return {
    postingId: post.glPostingId ?? null,
    docNumber: post.docNumber ?? null,
    status: settled.status === 'settled' ? 'settled' : 'issued',
  }
}

// ─── Void and discard ───────────────────────────────────────────────────────

export interface CreditMemoLifecycleInput {
  organizationId: string
  userId: string
  creditMemoInstanceId: string
}

/**
 * Void a memo: reverse its issue entry through `reverseEntry`, then set
 * `void`. Refused once anything has been applied or refunded (unapply first),
 * and the reversal goes FIRST so a refused reversal refuses the void with the
 * memo exactly as it was.
 *
 * A `channel` draft is voided without a posting, because its source row is
 * append-only and the connector must not resurrect it on re-ingest (section
 * 2.4). A `native` draft is discarded instead.
 */
export async function voidCreditMemo(db: Database, input: CreditMemoLifecycleInput): Promise<void> {
  const { organizationId, userId, creditMemoInstanceId } = input
  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)

  if (memo.status === 'void') {
    throw new BadRequestError('This credit memo is already void', { creditMemoInstanceId })
  }
  const writer = await statusWriter(db, organizationId, userId)

  if (memo.status === 'draft') {
    if (memo.source !== 'channel') {
      throw new BadRequestError('Discard a draft credit memo instead of voiding it', {
        creditMemoInstanceId,
      })
    }
    await writer.write(creditMemoInstanceId, [{ fieldId: 'credit_memo_status', value: 'void' }])
    return
  }

  const [applied, refunded] = await Promise.all([
    sumCreditMemoApplications(db, organizationId, creditMemoInstanceId),
    memo.source === 'channel'
      ? Promise.resolve(memo.amountRefundedMinor)
      : sumSucceededCreditMemoRefunds(db, organizationId, creditMemoInstanceId),
  ])
  if (applied > 0) {
    throw new BadRequestError('Unapply this credit memo from its invoices before voiding it', {
      creditMemoInstanceId,
      appliedMinor: String(applied),
    })
  }
  if (refunded > 0) {
    throw new BadRequestError(
      'This credit memo has been refunded and cannot be voided - the money has already moved',
      { creditMemoInstanceId, refundedMinor: String(refunded) }
    )
  }

  const postings = await listPostingsForSource(db, {
    organizationId,
    sourceType: CREDIT_MEMO_SOURCE_TYPE,
    sourceId: creditMemoInstanceId,
  })
  const live = postings.isOk()
    ? postings.value.filter(
        // `PostingStatus` is `posted | reversed` since the export split; a
        // reversed original has already left the books.
        (posting) =>
          posting.postingType === CREDIT_MEMO_POSTING_TYPE && posting.status !== 'reversed'
      )
    : []
  if (live.length > 0) {
    const lock = await resolvePeriodLock(organizationId)
    for (const posting of live) {
      const result = await reverseEntry(db, {
        organizationId,
        glPostingId: posting.id,
        actorUserId: userId,
        lock,
        memo: `Reversal of ${posting.docNumber} - credit memo ${memo.number} voided`,
      })
      if (!isExpectedPostOutcome(result)) {
        throw new BadRequestError(
          `This credit memo has a general ledger entry (${posting.docNumber}) that could not be ` +
            `reversed${result.error ? `: ${result.error}` : ` (${result.status})`}. Voiding it ` +
            'would leave the credit in the books with no document behind it.',
          { creditMemoInstanceId, docNumber: posting.docNumber, status: result.status }
        )
      }
    }
  }

  await writer.write(creditMemoInstanceId, [{ fieldId: 'credit_memo_status', value: 'void' }])
}

/**
 * Delete a draft. Only a draft: an issued memo is voided, and a `channel`
 * draft is voided too, because deleting it would let the connector re-ingest
 * it (section 2.4). The lines cascade from the registry's `onDelete`, and the
 * delete guard (`field-hooks/pre/credit-memo-delete-guard.ts`) runs the same
 * refusals for every other delete door.
 */
export async function discardCreditMemo(
  db: Database,
  input: CreditMemoLifecycleInput
): Promise<void> {
  const { organizationId, userId, creditMemoInstanceId } = input
  const memo = await requireCreditMemo(db, organizationId, creditMemoInstanceId)

  if (memo.status !== 'draft') {
    throw new BadRequestError(
      `This credit memo is ${memo.status} - void it instead of discarding it`,
      { creditMemoInstanceId, status: memo.status }
    )
  }
  if (memo.source === 'channel') {
    throw new BadRequestError(
      'A channel credit memo is voided, not discarded, so the connector does not bring it back',
      { creditMemoInstanceId }
    )
  }

  const handler = new UnifiedCrudHandler(organizationId, userId, db)
  await handler.delete(toRecordId('credit_memo', creditMemoInstanceId))
}
