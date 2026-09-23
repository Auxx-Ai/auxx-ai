// packages/lib/src/accounting/provider-matches/worklist-reads.ts
// What a person sees of the matcher (brief 102 M5): the worklist, the invoice's and the payout's
// provider side. No permission checks: the router asserts (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../../errors'
import { systemValueJoin } from '../../resources/system-records'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { findLiveSubjectPostings } from '../ledger/reads/list-postings'
import { LEDGER_CURRENCY } from '../ledger/setup/ledger-currency'
import { type ProviderPartyKind, resolveProviderParties } from '../mirror/provider-customers'
import { loadPayoutFieldContext } from '../money/payouts/fields'
import type {
  MatchState,
  PayoutProviderSide,
  ProviderMatchCounts,
  ProviderMatchKind,
  ProviderMatchReason,
  ProviderMatchRow,
  ProviderMatchSide,
} from './client'

export interface ListProviderMatchesInput {
  states?: MatchState[]
  reasons?: ProviderMatchReason[]
  limit?: number
  cursor?: string
}

const OPEN_STATES: MatchState[] = ['suggested', 'pending', 'unmatchable']
const DEFAULT_LIMIT = 50

/** The mirror's report label for an object type we send, where the cleared flag can be read. */
const MIRROR_TXN_TYPE: Record<string, string> = { deposit: 'Deposit', journal: 'Journal Entry' }

const entryColumns = {
  id: schema.ProviderLedgerEntry.id,
  bookId: schema.ProviderLedgerEntry.bookId,
  providerTxnType: schema.ProviderLedgerEntry.providerTxnType,
  providerTxnId: schema.ProviderLedgerEntry.providerTxnId,
  docNumber: schema.ProviderLedgerEntry.docNumber,
  txnDate: schema.ProviderLedgerEntry.txnDate,
  matchState: schema.ProviderLedgerEntry.matchState,
  matchReason: schema.ProviderLedgerEntry.matchReason,
  matchedKind: schema.ProviderLedgerEntry.matchedKind,
  matchedId: schema.ProviderLedgerEntry.matchedId,
  matchedBy: schema.ProviderLedgerEntry.matchedBy,
  matchedAt: schema.ProviderLedgerEntry.matchedAt,
}

type EntryRecord = {
  id: string
  bookId: string
  providerTxnType: string
  providerTxnId: string
  docNumber: string | null
  txnDate: string
  matchState: MatchState | null
  matchReason: string | null
  matchedKind: string | null
  matchedId: string | null
  matchedBy: string | null
  matchedAt: Date | null
}

function liveProviderEntries(organizationId: string): SQL {
  return and(
    eq(schema.ProviderLedgerEntry.organizationId, organizationId),
    eq(schema.ProviderLedgerEntry.author, 'provider'),
    isNull(schema.ProviderLedgerEntry.withdrawnAt),
    isNotNull(schema.ProviderLedgerEntry.matchReason)
  )!
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function encodeCursor(row: { txnDate: string; id: string }): string {
  return `${row.txnDate}|${row.id}`
}

function decodeCursor(cursor: string): { txnDate: string; id: string } | null {
  const [txnDate, id] = cursor.split('|')
  if (!txnDate || !id || !/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) return null
  return { txnDate, id }
}

/** The open worklist by default, newest first. */
export async function listProviderMatches(
  db: Database,
  organizationId: string,
  input: ListProviderMatchesInput = {}
): Promise<Result<{ rows: ProviderMatchRow[]; nextCursor: string | null }, Error>> {
  const after = input.cursor ? decodeCursor(input.cursor) : null
  if (input.cursor && !after) return err(new BadRequestError('Invalid cursor'))
  const e = schema.ProviderLedgerEntry
  const limit = input.limit ?? DEFAULT_LIMIT
  try {
    const entries = await db
      .select(entryColumns)
      .from(e)
      .where(
        and(
          liveProviderEntries(organizationId),
          inArray(e.matchState, input.states?.length ? input.states : OPEN_STATES),
          input.reasons?.length ? inArray(e.matchReason, input.reasons) : undefined,
          after
            ? or(
                lt(e.txnDate, after.txnDate),
                and(eq(e.txnDate, after.txnDate), lt(e.id, after.id))
              )
            : undefined
        )
      )
      .orderBy(desc(e.txnDate), desc(e.id))
      .limit(limit + 1)
    const page = entries.slice(0, limit)
    const rows = await hydrate(db, organizationId, page)
    const last = page[page.length - 1]
    return ok({ rows, nextCursor: entries.length > limit && last ? encodeCursor(last) : null })
  } catch (error) {
    return err(toError(error))
  }
}

/** The open worklist's size per state, for its badges. */
export async function countProviderMatches(
  db: Database,
  organizationId: string
): Promise<Result<ProviderMatchCounts, Error>> {
  const e = schema.ProviderLedgerEntry
  try {
    const rows = await db
      .select({ state: e.matchState, count: sql<number>`count(*)::int` })
      .from(e)
      .where(and(liveProviderEntries(organizationId), inArray(e.matchState, OPEN_STATES)))
      .groupBy(e.matchState)
    const counts: ProviderMatchCounts = { suggested: 0, pending: 0, unmatchable: 0 }
    for (const row of rows) {
      if (row.state && row.state in counts)
        counts[row.state as keyof ProviderMatchCounts] = row.count
    }
    return ok(counts)
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Provider payments that name this invoice: a suggested or matched receipt applied to it, or an
 * unmatchable payment the matcher pinned on it.
 */
export async function listProviderMatchesForInvoice(
  db: Database,
  organizationId: string,
  invoiceInstanceId: string
): Promise<Result<ProviderMatchRow[], Error>> {
  const e = schema.ProviderLedgerEntry
  const a = schema.MoneyApplication
  try {
    const receiptsOnInvoice = db
      .select({ id: a.moneyTransactionId })
      .from(a)
      .where(
        and(
          eq(a.organizationId, organizationId),
          eq(a.invoiceInstanceId, invoiceInstanceId),
          eq(a.operation, 'apply')
        )
      )
    const entries = await db
      .select(entryColumns)
      .from(e)
      .where(
        and(
          liveProviderEntries(organizationId),
          or(
            and(
              inArray(e.matchState, ['suggested', 'matched']),
              eq(e.matchedKind, 'money_transaction'),
              inArray(e.matchedId, receiptsOnInvoice)
            ),
            and(
              eq(e.matchState, 'unmatchable'),
              eq(e.matchedKind, 'invoice'),
              eq(e.matchedId, invoiceInstanceId)
            )
          )
        )
      )
      .orderBy(desc(e.txnDate), desc(e.id))
    return ok(await hydrate(db, organizationId, entries))
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * Provider transactions that name this vendor bill: a suggested or matched vendor payment applied
 * to it, or an entry pinned on the bill itself (`pays_bill`, `cannot_adopt`, `ambiguous`).
 */
export async function listProviderMatchesForVendorBill(
  db: Database,
  organizationId: string,
  vendorBillInstanceId: string
): Promise<Result<ProviderMatchRow[], Error>> {
  const e = schema.ProviderLedgerEntry
  const a = schema.MoneyApplication
  try {
    const paymentsOnBill = db
      .select({ id: a.moneyTransactionId })
      .from(a)
      .where(
        and(
          eq(a.organizationId, organizationId),
          eq(a.vendorBillInstanceId, vendorBillInstanceId),
          eq(a.operation, 'apply')
        )
      )
    const entries = await db
      .select(entryColumns)
      .from(e)
      .where(
        and(
          liveProviderEntries(organizationId),
          or(
            and(
              inArray(e.matchState, ['suggested', 'matched']),
              eq(e.matchedKind, 'money_transaction'),
              inArray(e.matchedId, paymentsOnBill)
            ),
            and(
              inArray(e.matchState, ['suggested', 'matched', 'unmatchable']),
              eq(e.matchedKind, 'vendor_bill'),
              eq(e.matchedId, vendorBillInstanceId)
            )
          )
        )
      )
      .orderBy(desc(e.txnDate), desc(e.id))
    return ok(await hydrate(db, organizationId, entries))
  } catch (error) {
    return err(toError(error))
  }
}

/**
 * The provider's side of one payout: where our Deposit stands and any duplicate of theirs.
 * `payoutId` is the `payout` record id (`payoutEvidence.detail`'s `payoutInstanceId`).
 */
export async function readPayoutProviderSide(
  db: Database,
  organizationId: string,
  payoutId: string
): Promise<Result<PayoutProviderSide, Error>> {
  const e = schema.ProviderLedgerEntry
  try {
    const [deposit, duplicateEntries] = await Promise.all([
      readPayoutDeposit(db, organizationId, payoutId),
      db
        .select(entryColumns)
        .from(e)
        .where(
          and(
            liveProviderEntries(organizationId),
            eq(e.matchedKind, 'payout'),
            eq(e.matchedId, payoutId),
            inArray(e.matchState, ['suggested', 'matched'])
          )
        )
        .orderBy(desc(e.txnDate), desc(e.id)),
    ])
    return ok({ deposit, duplicates: await hydrate(db, organizationId, duplicateEntries) })
  } catch (error) {
    return err(toError(error))
  }
}

async function readPayoutDeposit(
  db: Database,
  organizationId: string,
  payoutId: string
): Promise<PayoutProviderSide['deposit']> {
  const live = await findLiveSubjectPostings(db, organizationId, {
    sourceKind: 'payout',
    sourceIds: [payoutId],
  })
  const posting = live.get(payoutId)
  if (!posting) return null

  const [batch] = await db
    .select({
      batchState: schema.ExportBatch.state,
      providerObjectId: schema.ExportBatch.providerObjectId,
      objectType: schema.ExportBatch.objectType,
      bookId: schema.ExportBatch.bookId,
      sentAt: schema.ExportBatch.sentAt,
    })
    .from(schema.ExportBatchPosting)
    .innerJoin(
      schema.ExportBatch,
      and(
        eq(schema.ExportBatch.organizationId, organizationId),
        eq(schema.ExportBatch.id, schema.ExportBatchPosting.batchId)
      )
    )
    .where(
      and(
        eq(schema.ExportBatchPosting.organizationId, organizationId),
        eq(schema.ExportBatchPosting.glPostingId, posting.glPostingId),
        isNull(schema.ExportBatchPosting.withdrawnAt)
      )
    )
    .orderBy(desc(schema.ExportBatch.createdAt))
    .limit(1)
  if (!batch) return null

  const mirrorTxnType = MIRROR_TXN_TYPE[batch.objectType]
  let cleared: string | null = null
  if (batch.batchState === 'sent' && batch.providerObjectId && mirrorTxnType) {
    const flags = await db
      .select({ cleared: sql<string | null>`${schema.ProviderLedgerLine.raw}->>'cleared'` })
      .from(schema.ProviderLedgerEntry)
      .innerJoin(
        schema.ProviderLedgerLine,
        eq(schema.ProviderLedgerLine.entryId, schema.ProviderLedgerEntry.id)
      )
      .where(
        and(
          eq(schema.ProviderLedgerEntry.organizationId, organizationId),
          eq(schema.ProviderLedgerEntry.bookId, batch.bookId),
          eq(schema.ProviderLedgerEntry.author, 'auxx'),
          eq(schema.ProviderLedgerEntry.providerTxnType, mirrorTxnType),
          eq(schema.ProviderLedgerEntry.providerTxnId, batch.providerObjectId),
          isNull(schema.ProviderLedgerEntry.withdrawnAt),
          sql`coalesce(${schema.ProviderLedgerLine.raw}->>'cleared', '') <> ''`
        )
      )
    // QuickBooks sets the flag on the bank line alone; reconciled outranks cleared.
    cleared = flags.find((flag) => flag.cleared === 'R')?.cleared ?? flags[0]?.cleared ?? null
  }
  return { ...batch, cleared }
}

/** Amounts, customers and our side for a page of entries: one query per concern, never per row. */
async function hydrate(
  db: Database,
  organizationId: string,
  entries: EntryRecord[]
): Promise<ProviderMatchRow[]> {
  if (entries.length === 0) return []
  const [lines, matched] = await Promise.all([
    db
      .select({
        entryId: schema.ProviderLedgerLine.entryId,
        direction: schema.ProviderLedgerLine.direction,
        amountMinor: schema.ProviderLedgerLine.amountMinor,
        providerCustomerId: schema.ProviderLedgerLine.providerCustomerId,
        providerVendorId: schema.ProviderLedgerLine.providerVendorId,
      })
      .from(schema.ProviderLedgerLine)
      .where(
        inArray(
          schema.ProviderLedgerLine.entryId,
          entries.map((entry) => entry.id)
        )
      ),
    readMatchedSides(db, organizationId, entries),
  ])

  const amountByEntry = new Map<string, number>()
  const customersByEntry = new Map<string, Set<string>>()
  const vendorsByEntry = new Map<string, Set<string>>()
  for (const line of lines) {
    if (line.direction === 'debit')
      amountByEntry.set(
        line.entryId,
        (amountByEntry.get(line.entryId) ?? 0) + Number(line.amountMinor)
      )
    if (line.providerCustomerId) {
      const set = customersByEntry.get(line.entryId) ?? new Set<string>()
      set.add(line.providerCustomerId)
      customersByEntry.set(line.entryId, set)
    }
    if (line.providerVendorId) {
      const set = vendorsByEntry.get(line.entryId) ?? new Set<string>()
      set.add(line.providerVendorId)
      vendorsByEntry.set(line.entryId, set)
    }
  }
  const customerNameByEntry = await readPartyNames(db, organizationId, entries, {
    customer: customersByEntry,
    vendor: vendorsByEntry,
  })

  return entries.map((entry) => ({
    id: entry.id,
    bookId: entry.bookId,
    providerTxnType: entry.providerTxnType,
    providerTxnId: entry.providerTxnId,
    docNumber: entry.docNumber,
    txnDate: entry.txnDate,
    amountMinor: amountByEntry.get(entry.id) ?? 0,
    currency: LEDGER_CURRENCY,
    customerName: customerNameByEntry.get(entry.id) ?? null,
    matchState: entry.matchState,
    matchReason: entry.matchReason as ProviderMatchReason,
    matchedKind: entry.matchedKind as ProviderMatchKind | null,
    matchedId: entry.matchedId,
    matched:
      entry.matchedKind && entry.matchedId
        ? (matched.get(`${entry.matchedKind}:${entry.matchedId}`) ?? null)
        : null,
    matchedBy: entry.matchedBy,
    matchedAt: entry.matchedAt,
  }))
}

/**
 * Our contact's name per entry when its lines name exactly one provider customer we know, else
 * our vendor company's when they name exactly one provider vendor.
 */
async function readPartyNames(
  db: Database,
  organizationId: string,
  entries: EntryRecord[],
  partiesByEntry: Record<ProviderPartyKind, Map<string, Set<string>>>
): Promise<Map<string, string>> {
  const recordByEntry = new Map<string, string>()
  for (const kind of ['customer', 'vendor'] as const) {
    const resolved = await resolveSingleParties(
      db,
      organizationId,
      entries.filter((entry) => !recordByEntry.has(entry.id)),
      kind,
      partiesByEntry[kind]
    )
    for (const [entryId, recordId] of resolved) recordByEntry.set(entryId, recordId)
  }
  const names = await readDisplayNames(db, organizationId, [...recordByEntry.values()])
  const byEntry = new Map<string, string>()
  for (const [entryId, recordId] of recordByEntry) {
    const name = names.get(recordId)
    if (name) byEntry.set(entryId, name)
  }
  return byEntry
}

/** Entry → our record, for entries whose lines name exactly one provider party of this kind. */
async function resolveSingleParties(
  db: Database,
  organizationId: string,
  entries: EntryRecord[],
  kind: ProviderPartyKind,
  partiesByEntry: Map<string, Set<string>>
): Promise<Map<string, string>> {
  const single = new Map<string, string>()
  for (const entry of entries) {
    const parties = partiesByEntry.get(entry.id)
    if (parties?.size === 1) single.set(entry.id, [...parties][0]!)
  }
  if (single.size === 0) return new Map()

  const books = await db
    .select({
      id: schema.ExternalAccountingBook.id,
      providerKey: schema.ExternalAccountingBook.providerKey,
    })
    .from(schema.ExternalAccountingBook)
    .where(
      and(
        eq(schema.ExternalAccountingBook.organizationId, organizationId),
        inArray(schema.ExternalAccountingBook.id, [
          ...new Set(entries.map((entry) => entry.bookId)),
        ])
      )
    )
  const providerByBook = new Map(books.map((book) => [book.id, book.providerKey]))

  const recordByEntry = new Map<string, string>()
  for (const providerKey of new Set(providerByBook.values())) {
    const mine = entries.filter(
      (entry) => providerByBook.get(entry.bookId) === providerKey && single.has(entry.id)
    )
    const records = await resolveProviderParties(
      db,
      organizationId,
      providerKey,
      kind,
      mine.map((entry) => single.get(entry.id)!)
    )
    for (const entry of mine) {
      const recordId = records.get(single.get(entry.id)!)
      if (recordId) recordByEntry.set(entry.id, recordId)
    }
  }
  return recordByEntry
}

async function readDisplayNames(
  db: Database,
  organizationId: string,
  ids: readonly string[]
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...new Set(ids)])
      )
    )
  return new Map(rows.map((row) => [row.id, row.displayName]))
}

function idsOfKind(entries: EntryRecord[], kind: ProviderMatchKind): string[] {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        entry.matchedKind === kind && entry.matchedId ? [entry.matchedId] : []
      )
    ),
  ]
}

/** Our side keyed `${kind}:${id}`, one read per kind. */
async function readMatchedSides(
  db: Database,
  organizationId: string,
  entries: EntryRecord[]
): Promise<Map<string, ProviderMatchSide>> {
  const [receipts, payouts, invoices, bills] = await Promise.all([
    readReceiptSides(db, organizationId, idsOfKind(entries, 'money_transaction')),
    readPostedSides(db, organizationId, 'payout', idsOfKind(entries, 'payout')),
    readPostedSides(db, organizationId, 'invoice', idsOfKind(entries, 'invoice')),
    readPostedSides(db, organizationId, 'vendor_bill', idsOfKind(entries, 'vendor_bill')),
  ])
  const sides = new Map<string, ProviderMatchSide>()
  for (const [id, side] of receipts) sides.set(`money_transaction:${id}`, side)
  for (const [id, side] of payouts) sides.set(`payout:${id}`, side)
  for (const [id, side] of invoices) sides.set(`invoice:${id}`, side)
  for (const [id, side] of bills) sides.set(`vendor_bill:${id}`, side)
  return sides
}

async function readReceiptSides(
  db: Database,
  organizationId: string,
  ids: string[]
): Promise<Map<string, ProviderMatchSide>> {
  if (ids.length === 0) return new Map()
  const t = schema.MoneyTransaction
  const a = schema.MoneyApplication
  const [receipts, applications] = await Promise.all([
    db
      .select({
        id: t.id,
        purpose: t.purpose,
        reference: t.reference,
        amountMinor: t.amountMinor,
        occurredOn: t.occurredOn,
        occurredAt: t.occurredAt,
      })
      .from(t)
      .where(and(eq(t.organizationId, organizationId), inArray(t.id, ids))),
    db
      .selectDistinct({
        moneyTransactionId: a.moneyTransactionId,
        invoiceInstanceId: a.invoiceInstanceId,
        vendorBillInstanceId: a.vendorBillInstanceId,
      })
      .from(a)
      .where(
        and(
          eq(a.organizationId, organizationId),
          inArray(a.moneyTransactionId, ids),
          eq(a.operation, 'apply'),
          or(isNotNull(a.invoiceInstanceId), isNotNull(a.vendorBillInstanceId))
        )
      ),
  ])
  const invoicesByReceipt = new Map<string, string[]>()
  const billsByPayment = new Map<string, string[]>()
  for (const row of applications) {
    for (const [byMovement, id] of [
      [invoicesByReceipt, row.invoiceInstanceId],
      [billsByPayment, row.vendorBillInstanceId],
    ] as const) {
      if (!id) continue
      byMovement.set(row.moneyTransactionId, [
        ...(byMovement.get(row.moneyTransactionId) ?? []),
        id,
      ])
    }
  }
  const onlyOne = (list: string[] | undefined) => (list?.length === 1 ? list[0]! : null)
  return new Map(
    receipts.map((receipt) => [
      receipt.id,
      {
        label:
          receipt.reference?.trim() ||
          (receipt.purpose === 'vendor_payment' ? 'Vendor payment' : 'Receipt'),
        date: receipt.occurredOn ?? receipt.occurredAt?.toISOString().slice(0, 10) ?? null,
        amountMinor: Number(receipt.amountMinor),
        invoiceInstanceId: onlyOne(invoicesByReceipt.get(receipt.id)),
        vendorBillInstanceId: onlyOne(billsByPayment.get(receipt.id)),
        payoutEvidenceId: null,
      },
    ])
  )
}

const POSTED_SIDE_LABEL = { payout: 'Payout', invoice: 'Invoice', vendor_bill: 'Vendor bill' }

/**
 * A payout, an invoice or a vendor bill by its record's name and its live posting. A payout's
 * amount is its bank line, the figure the matcher compared; the others' is their posting total.
 */
async function readPostedSides(
  db: Database,
  organizationId: string,
  kind: keyof typeof POSTED_SIDE_LABEL,
  ids: string[]
): Promise<Map<string, ProviderMatchSide>> {
  if (ids.length === 0) return new Map()
  const [names, live, evidence] = await Promise.all([
    readDisplayNames(db, organizationId, ids),
    findLiveSubjectPostings(db, organizationId, { sourceKind: kind, sourceIds: ids }),
    kind === 'payout'
      ? readPayoutEvidenceIds(db, organizationId, ids)
      : Promise.resolve(new Map<string, string>()),
  ])
  const bankByPosting = new Map<string, number>()
  if (kind === 'payout' && live.size > 0) {
    const l = schema.GlPostingLine
    const bankLines = await db
      .select({ glPostingId: l.glPostingId, amountMinor: l.amountMinor })
      .from(l)
      .where(
        and(
          eq(l.organizationId, organizationId),
          inArray(
            l.glPostingId,
            [...live.values()].map((posting) => posting.glPostingId)
          ),
          eq(l.accountRole, ACCOUNT_ROLES.BANK),
          eq(l.direction, 'debit')
        )
      )
    for (const line of bankLines)
      bankByPosting.set(
        line.glPostingId,
        (bankByPosting.get(line.glPostingId) ?? 0) + Number(line.amountMinor)
      )
  }

  const sides = new Map<string, ProviderMatchSide>()
  for (const id of ids) {
    const posting = live.get(id)
    const name = names.get(id)
    if (!posting && name === undefined) continue
    sides.set(id, {
      label: name?.trim() || posting?.docNumber || POSTED_SIDE_LABEL[kind],
      date: posting?.txnDate ?? null,
      amountMinor: posting
        ? kind === 'payout'
          ? (bankByPosting.get(posting.glPostingId) ?? null)
          : posting.totalMinor
        : null,
      invoiceInstanceId: kind === 'invoice' ? id : null,
      vendorBillInstanceId: kind === 'vendor_bill' ? id : null,
      payoutEvidenceId: evidence.get(id) ?? null,
    })
  }
  return sides
}

/**
 * Payout record → its `MoneyTransfer`, the inverse of `evidence-reads.ts` `payoutInstance`: the
 * record's gateway id is the transfer's `externalId`, and a stamped rail must be the account's.
 */
async function readPayoutEvidenceIds(
  db: Database,
  organizationId: string,
  payoutIds: string[]
): Promise<Map<string, string>> {
  const ctx = await loadPayoutFieldContext(db, organizationId)
  const gatewayField = ctx?.fields.payout_gateway_id
  if (!gatewayField) return new Map()
  const railField = ctx.fields.payout_payment_gateway
  const gatewayId = alias(schema.FieldValue, 'payout_gateway_id_v')
  const rail = alias(schema.FieldValue, 'payout_payment_gateway_v')
  const t = schema.MoneyTransfer
  const account = schema.FinancialSourceAccount
  const railId = railField ? rail.relatedEntityId : sql<string | null>`NULL`

  let query = db
    .select({ payoutId: schema.EntityInstance.id, evidenceId: t.id, railId })
    .from(schema.EntityInstance)
    .innerJoin(gatewayId, systemValueJoin(gatewayId, gatewayField.id))
    .innerJoin(t, and(eq(t.organizationId, organizationId), eq(t.externalId, gatewayId.valueText)))
    .innerJoin(
      account,
      and(eq(account.organizationId, organizationId), eq(account.id, t.sourceAccountId))
    )
    .$dynamic()
  if (railField) query = query.leftJoin(rail, systemValueJoin(rail, railField.id))
  const rows = await query
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, payoutIds),
        railField
          ? sql`(${rail.relatedEntityId} IS NULL OR ${account.paymentGatewayId} IS NULL OR ${rail.relatedEntityId} = ${account.paymentGatewayId})`
          : undefined
      )
    )
    // A rail-stamped pairing outranks an unstamped one when one gateway id reaches two accounts.
    .orderBy(sql`${railId} IS NULL`, t.id)

  const byPayout = new Map<string, string>()
  for (const row of rows)
    if (!byPayout.has(row.payoutId)) byPayout.set(row.payoutId, row.evidenceId)
  return byPayout
}
