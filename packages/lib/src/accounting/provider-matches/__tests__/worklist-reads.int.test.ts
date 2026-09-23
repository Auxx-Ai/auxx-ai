// packages/lib/src/accounting/provider-matches/__tests__/worklist-reads.int.test.ts
// DB-backed: the reads are joins and filters, which a stubbed query cannot prove narrow.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, getTestDb } from '@auxx/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  countProviderMatches,
  listProviderMatches,
  listProviderMatchesForInvoice,
  listProviderMatchesForVendorBill,
  readPayoutProviderSide,
} from '../worklist-reads'

const db = () => getTestDb() as unknown as Database

let organizationId: string
let userId: string
let bookId: string
let invoiceDefId: string
let payoutDefId: string

type EntryInput = {
  txnId: string
  txnType?: string
  txnDate?: string
  author?: 'auxx' | 'provider'
  state?: 'pending' | 'suggested' | 'matched' | 'unmatchable' | null
  reason?: string | null
  kind?: string | null
  matchedId?: string | null
  withdrawn?: boolean
  org?: string
  lines?: Array<{ direction: 'debit' | 'credit'; amountMinor: number; cleared?: string }>
}

async function entry(input: EntryInput): Promise<string> {
  const org = input.org ?? organizationId
  const [row] = await db()
    .insert(schema.ProviderLedgerEntry)
    .values({
      organizationId: org,
      bookId,
      providerTxnType: input.txnType ?? 'Payment',
      providerTxnId: input.txnId,
      txnDate: input.txnDate ?? '2026-09-22',
      docNumber: `DOC-${input.txnId}`,
      author: input.author ?? 'provider',
      withdrawnAt: input.withdrawn ? new Date() : null,
      matchState: input.state === undefined ? 'suggested' : input.state,
      matchReason: input.reason === undefined ? 'ours_unsent' : input.reason,
      matchedKind: input.kind ?? null,
      matchedId: input.matchedId ?? null,
    })
    .returning({ id: schema.ProviderLedgerEntry.id })
  const lines = input.lines ?? [
    { direction: 'debit' as const, amountMinor: 10000 },
    { direction: 'credit' as const, amountMinor: 10000 },
  ]
  await db()
    .insert(schema.ProviderLedgerLine)
    .values(
      lines.map((line, index) => ({
        entryId: row!.id,
        providerAccountId: `acct_${index}`,
        direction: line.direction,
        amountMinor: line.amountMinor,
        sortOrder: index,
        raw: line.cleared ? { cleared: line.cleared } : {},
      }))
    )
  return row!.id
}

async function definition(slug: string): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      apiSlug: slug,
      entityType: slug,
      singular: slug,
      plural: `${slug}s`,
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityDefinition.id })
  return row!.id
}

async function record(entityDefinitionId: string, displayName: string): Promise<string> {
  const [row] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId,
      entityDefinitionId,
      displayName,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning({ id: schema.EntityInstance.id })
  return row!.id
}

/** A $100 receipt of ours applied to one invoice, or a vendor payment applied to one bill. */
async function receiptOn(
  invoiceId: string,
  reference: string,
  side: 'invoice' | 'vendor_bill' = 'invoice'
): Promise<string> {
  const [command] = await db()
    .insert(schema.MoneyCommand)
    .values({
      organizationId,
      commandKey: `cmd-${reference}`,
      kind: 'record_payment',
      payloadHash: reference,
      actorSnapshot: {},
    })
    .returning({ id: schema.MoneyCommand.id })
  const [receipt] = await db()
    .insert(schema.MoneyTransaction)
    .values({
      organizationId,
      purpose: side === 'invoice' ? 'customer_receipt' : 'vendor_payment',
      amountMinor: 10000n,
      currency: 'USD',
      currencyExponent: 2,
      datePrecision: 'date',
      occurredOn: '2026-09-20',
      recordedByCommandId: command!.id,
      reference,
    })
    .returning({ id: schema.MoneyTransaction.id })
  await db()
    .insert(schema.MoneyApplication)
    .values({
      organizationId,
      moneyTransactionId: receipt!.id,
      operation: 'apply',
      amountMinor: 10000n,
      ...(side === 'invoice'
        ? { invoiceInstanceId: invoiceId }
        : { vendorBillInstanceId: invoiceId }),
      appliedAt: new Date(),
      effectiveDate: '2026-09-20',
      commandId: command!.id,
      commandItemKey: 'apply-0',
    })
  return receipt!.id
}

/** Our payout's posting (bank Dr 97, fees Dr 3, clearing Cr 100), optionally in a sent batch. */
async function postedPayout(payoutId: string, batch?: { providerObjectId: string }) {
  const [posting] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId,
      postingType: 'payout',
      periodKey: '2026-09',
      txnDate: '2026-09-21',
      docNumber: `PO-${payoutId.slice(0, 6)}`,
      totalMinor: 10000,
      built: { v: 1 },
      postedAt: new Date(),
    })
    .returning({ id: schema.GlPosting.id })
  const line = (
    lineNumber: number,
    accountRole: string,
    direction: 'debit' | 'credit',
    amountMinor: number
  ) => ({
    organizationId,
    glPostingId: posting!.id,
    lineNumber,
    glAccountId: `gl_${accountRole}`,
    accountRole,
    direction,
    amountMinor,
    sourceType: 'payout',
    sourceId: payoutId,
  })
  await db()
    .insert(schema.GlPostingLine)
    .values([
      line(1, 'bank', 'debit', 9700),
      line(2, 'payment_processing_fees', 'debit', 300),
      line(3, 'clearing', 'credit', 10000),
    ])
  await db().insert(schema.GlPostingSource).values({
    organizationId,
    glPostingId: posting!.id,
    sourceKind: 'payout',
    sourceId: payoutId,
    linkRole: 'subject',
  })
  if (!batch) return
  const [connection] = await db()
    .insert(schema.ExternalBookConnection)
    .values({
      organizationId,
      bookId,
      epoch: 1,
      credentialBindingSnapshot: 'test',
      state: 'active',
      exportFromDate: '2026-01-01',
      openingPolicy: {},
    })
    .returning({ id: schema.ExternalBookConnection.id })
  const [sent] = await db()
    .insert(schema.ExportBatch)
    .values({
      organizationId,
      bookId,
      connectionId: connection!.id,
      mode: 'transaction',
      avenue: 'payouts',
      grainKey: posting!.id,
      currency: 'USD',
      objectType: 'deposit',
      payload: {},
      payloadHash: 'a'.repeat(64),
      state: 'sent',
      providerObjectId: batch.providerObjectId,
      totalMinor: 10000,
      sentAt: new Date('2026-09-21T12:00:00Z'),
    })
    .returning({ id: schema.ExportBatch.id })
  await db().insert(schema.ExportBatchPosting).values({
    organizationId,
    batchId: sent!.id,
    glPostingId: posting!.id,
  })
}

/** A text system field on `defId` holding `value` for `entityId`. */
async function systemText(defId: string, attribute: string, entityId: string, value: string) {
  const [field] = await db()
    .insert(schema.CustomField)
    .values({
      organizationId,
      entityDefinitionId: defId,
      name: attribute,
      type: 'TEXT',
      systemAttribute: attribute,
      updatedAt: new Date(),
    })
    .returning({ id: schema.CustomField.id })
  await db().insert(schema.FieldValue).values({
    organizationId,
    fieldId: field!.id,
    entityId,
    entityDefinitionId: defId,
    valueText: value,
  })
}

/** The `MoneyTransfer` the Payouts drawer opens on, for a provider payout id. */
async function payoutEvidence(externalId: string): Promise<string> {
  const [account] = await db()
    .insert(schema.FinancialSourceAccount)
    .values({
      organizationId,
      providerKey: 'shopify_payments',
      externalAccountId: 'acct-1',
      environment: 'live',
    })
    .returning({ id: schema.FinancialSourceAccount.id })
  const [object] = await db()
    .insert(schema.FinancialSourceObject)
    .values({
      organizationId,
      sourceAccountId: account!.id,
      objectType: 'payout',
      externalId,
      componentKey: '',
    })
    .returning({ id: schema.FinancialSourceObject.id })
  const [observation] = await db()
    .insert(schema.FinancialSourceObservation)
    .values({
      organizationId,
      sourceObjectId: object!.id,
      contentHash: externalId,
      observedAt: new Date(),
      payload: {},
      reportingInstallationSnapshot: {},
    })
    .returning({ id: schema.FinancialSourceObservation.id })
  const transferId = await record(await definition('money_transfer'), externalId)
  await db().insert(schema.MoneyTransfer).values({
    id: transferId,
    organizationId,
    sourceAccountId: account!.id,
    sourceObjectId: object!.id,
    currentObservationId: observation!.id,
    externalId,
    status: 'paid',
    sourceAmountMinor: 9700n,
    sourceCurrency: 'USD',
    sourceCurrencyExponent: 2,
    destinationAmountMinor: 9700n,
    destinationCurrency: 'USD',
    destinationCurrencyExponent: 2,
    datePrecision: 'date',
    occurredOn: '2026-09-21',
  })
  return transferId
}

beforeEach(async () => {
  const org = await createTestOrganization()
  organizationId = org.id
  userId = org.ownerId
  const [book] = await db()
    .insert(schema.ExternalAccountingBook)
    .values({ organizationId, providerKey: 'quickbooks', externalCompanyId: 'company-1' })
    .returning({ id: schema.ExternalAccountingBook.id })
  bookId = book!.id
  invoiceDefId = await definition('invoice')
  payoutDefId = await definition('payout')
})

describe('listProviderMatches', () => {
  it('lists the open worklist only: provider-authored, live, assessed and not settled', async () => {
    await entry({ txnId: 'suggested' })
    await entry({ txnId: 'pending', txnType: 'Deposit', state: 'pending', reason: 'no_payout' })
    await entry({ txnId: 'unmatchable', state: 'unmatchable', reason: 'cannot_adopt' })
    await entry({ txnId: 'matched', state: 'matched', reason: 'adopted' })
    await entry({ txnId: 'not-ours', state: null, reason: 'not_ours' })
    await entry({ txnId: 'unassessed', state: null, reason: null })
    await entry({ txnId: 'withdrawn', withdrawn: true })
    await entry({ txnId: 'ours', author: 'auxx' })
    const other = await createTestOrganization()
    const [otherBook] = await db()
      .insert(schema.ExternalAccountingBook)
      .values({ organizationId: other.id, providerKey: 'quickbooks', externalCompanyId: 'c2' })
      .returning({ id: schema.ExternalAccountingBook.id })
    await db().insert(schema.ProviderLedgerEntry).values({
      organizationId: other.id,
      bookId: otherBook!.id,
      providerTxnType: 'Payment',
      providerTxnId: 'foreign',
      txnDate: '2026-09-22',
      author: 'provider',
      matchState: 'suggested',
      matchReason: 'ours_unsent',
    })

    const result = (await listProviderMatches(db(), organizationId))._unsafeUnwrap()
    expect(result.rows.map((row) => row.providerTxnId).sort()).toEqual([
      'pending',
      'suggested',
      'unmatchable',
    ])
    expect(result.nextCursor).toBeNull()
    expect(result.rows[0]).toMatchObject({ amountMinor: 10000, currency: 'USD', bookId })
  })

  it('narrows by state and by reason', async () => {
    await entry({ txnId: 'a', reason: 'ours_unsent' })
    await entry({ txnId: 'b', reason: 'duplicate_sent' })
    await entry({ txnId: 'c', state: 'matched', reason: 'adopted' })

    const byReason = await listProviderMatches(db(), organizationId, {
      reasons: ['duplicate_sent'],
    })
    expect(byReason._unsafeUnwrap().rows.map((row) => row.providerTxnId)).toEqual(['b'])
    const matched = await listProviderMatches(db(), organizationId, { states: ['matched'] })
    expect(matched._unsafeUnwrap().rows.map((row) => row.providerTxnId)).toEqual(['c'])
  })

  it('pages newest first without repeating a row across a same-day tie', async () => {
    await entry({ txnId: 'old', txnDate: '2026-09-01' })
    await entry({ txnId: 'new-1', txnDate: '2026-09-22' })
    await entry({ txnId: 'new-2', txnDate: '2026-09-22' })

    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = (
        await listProviderMatches(db(), organizationId, { limit: 1, cursor })
      )._unsafeUnwrap()
      seen.push(...page.rows.map((row) => row.providerTxnId))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toHaveLength(3)
    expect(new Set(seen).size).toBe(3)
    expect(seen[2]).toBe('old')
  })

  it('refuses a cursor it did not write', async () => {
    const result = await listProviderMatches(db(), organizationId, { cursor: 'nonsense' })
    expect(result.isErr()).toBe(true)
  })

  it('reads our receipt beside theirs, with the one invoice it is applied to', async () => {
    const invoiceId = await record(invoiceDefId, 'INV-1001')
    const receiptId = await receiptOn(invoiceId, 'CHK-77')
    await entry({ txnId: 'p', kind: 'money_transaction', matchedId: receiptId })

    const [row] = (await listProviderMatches(db(), organizationId))._unsafeUnwrap().rows
    expect(row!.matched).toEqual({
      label: 'CHK-77',
      date: '2026-09-20',
      amountMinor: 10000,
      invoiceInstanceId: invoiceId,
      vendorBillInstanceId: null,
      payoutEvidenceId: null,
    })
  })
})

describe('countProviderMatches', () => {
  it('counts the open states of live provider entries', async () => {
    await entry({ txnId: 'a' })
    await entry({ txnId: 'b' })
    await entry({ txnId: 'c', state: 'unmatchable', reason: 'ambiguous' })
    await entry({ txnId: 'd', state: 'matched', reason: 'adopted' })
    await entry({ txnId: 'e', withdrawn: true })

    const counts = (await countProviderMatches(db(), organizationId))._unsafeUnwrap()
    expect(counts).toEqual({ suggested: 2, pending: 0, unmatchable: 1 })
  })
})

describe('listProviderMatchesForInvoice', () => {
  it('finds a suggested receipt applied to the invoice and a payment pinned on it', async () => {
    const invoiceId = await record(invoiceDefId, 'INV-1001')
    const elsewhere = await record(invoiceDefId, 'INV-1002')
    const receiptId = await receiptOn(invoiceId, 'CHK-1')
    const otherReceipt = await receiptOn(elsewhere, 'CHK-2')
    await entry({ txnId: 'on-receipt', kind: 'money_transaction', matchedId: receiptId })
    await entry({
      txnId: 'pinned',
      state: 'unmatchable',
      reason: 'cannot_adopt',
      kind: 'invoice',
      matchedId: invoiceId,
    })
    await entry({ txnId: 'other-invoice', kind: 'money_transaction', matchedId: otherReceipt })
    await entry({ txnId: 'dismissed', state: null, reason: 'dismissed' })

    const rows = (
      await listProviderMatchesForInvoice(db(), organizationId, invoiceId)
    )._unsafeUnwrap()
    expect(rows.map((row) => row.providerTxnId).sort()).toEqual(['on-receipt', 'pinned'])
    expect(rows.find((row) => row.providerTxnId === 'pinned')!.matched).toEqual({
      label: 'INV-1001',
      date: null,
      amountMinor: null,
      invoiceInstanceId: invoiceId,
      vendorBillInstanceId: null,
      payoutEvidenceId: null,
    })
  })
})

describe('listProviderMatchesForVendorBill', () => {
  it('finds a vendor payment applied to the bill and an expense pinned on the bill', async () => {
    const billDefId = await definition('vendor_bill')
    const billId = await record(billDefId, 'BILL-7')
    const elsewhere = await record(billDefId, 'BILL-8')
    const paymentId = await receiptOn(billId, 'ACH-1', 'vendor_bill')
    const otherPayment = await receiptOn(elsewhere, 'ACH-2', 'vendor_bill')
    await entry({
      txnId: 'on-payment',
      txnType: 'Bill Payment (Check)',
      kind: 'money_transaction',
      matchedId: paymentId,
    })
    await entry({
      txnId: 'pays-bill',
      txnType: 'Check',
      reason: 'pays_bill',
      kind: 'vendor_bill',
      matchedId: billId,
    })
    await entry({ txnId: 'other-bill', kind: 'money_transaction', matchedId: otherPayment })
    await entry({
      txnId: 'dismissed',
      state: null,
      reason: 'dismissed',
      kind: 'vendor_bill',
      matchedId: billId,
    })

    const rows = (
      await listProviderMatchesForVendorBill(db(), organizationId, billId)
    )._unsafeUnwrap()
    expect(rows.map((row) => row.providerTxnId).sort()).toEqual(['on-payment', 'pays-bill'])
    expect(rows.find((row) => row.providerTxnId === 'on-payment')!.matched).toEqual({
      label: 'ACH-1',
      date: '2026-09-20',
      amountMinor: 10000,
      invoiceInstanceId: null,
      vendorBillInstanceId: billId,
      payoutEvidenceId: null,
    })
    expect(rows.find((row) => row.providerTxnId === 'pays-bill')!.matched).toEqual({
      label: 'BILL-7',
      date: null,
      amountMinor: null,
      invoiceInstanceId: null,
      vendorBillInstanceId: billId,
      payoutEvidenceId: null,
    })
  })
})

describe('readPayoutProviderSide', () => {
  it('has no deposit while our payout has not posted, and still lists a duplicate', async () => {
    const payoutId = await record(payoutDefId, 'Payout po_1')
    await entry({
      txnId: 'feed-add',
      txnType: 'Deposit',
      reason: 'duplicate_sent',
      kind: 'payout',
      matchedId: payoutId,
    })
    await entry({
      txnId: 'dismissed',
      txnType: 'Deposit',
      state: null,
      reason: 'dismissed',
    })

    const side = (await readPayoutProviderSide(db(), organizationId, payoutId))._unsafeUnwrap()
    expect(side.deposit).toBeNull()
    expect(side.duplicates.map((row) => row.providerTxnId)).toEqual(['feed-add'])
    expect(side.duplicates[0]!.matched).toMatchObject({ label: 'Payout po_1', amountMinor: null })
  })

  it('reads our sent Deposit and the cleared flag on its bank line in the mirror', async () => {
    const payoutId = await record(payoutDefId, 'Payout po_2')
    await postedPayout(payoutId, { providerObjectId: '555' })
    await entry({
      txnId: '555',
      txnType: 'Deposit',
      author: 'auxx',
      state: null,
      reason: null,
      lines: [
        { direction: 'debit', amountMinor: 9700, cleared: 'R' },
        { direction: 'credit', amountMinor: 9700 },
      ],
    })
    await entry({
      txnId: 'feed-add',
      txnType: 'Deposit',
      reason: 'duplicate_sent',
      kind: 'payout',
      matchedId: payoutId,
      lines: [
        { direction: 'debit', amountMinor: 9700 },
        { direction: 'credit', amountMinor: 9700 },
      ],
    })

    const side = (await readPayoutProviderSide(db(), organizationId, payoutId))._unsafeUnwrap()
    expect(side.deposit).toMatchObject({
      batchState: 'sent',
      providerObjectId: '555',
      objectType: 'deposit',
      bookId,
      cleared: 'R',
    })
    expect(side.duplicates[0]!.matched).toEqual({
      label: 'Payout po_2',
      date: '2026-09-21',
      amountMinor: 9700,
      invoiceInstanceId: null,
      vendorBillInstanceId: null,
      payoutEvidenceId: null,
    })
  })

  it('names the Payouts drawer a payout of ours opens on', async () => {
    const payoutId = await record(payoutDefId, 'Payout po_3')
    await systemText(payoutDefId, 'payout_gateway_id', payoutId, 'po_3')
    await systemText(payoutDefId, 'payout_status', payoutId, 'paid')
    const transferId = await payoutEvidence('po_3')
    await entry({
      txnId: 'feed-add',
      txnType: 'Deposit',
      reason: 'duplicate_sent',
      kind: 'payout',
      matchedId: payoutId,
    })

    const [row] = (await listProviderMatches(db(), organizationId))._unsafeUnwrap().rows
    expect(row!.matched).toMatchObject({ label: 'Payout po_3', payoutEvidenceId: transferId })
  })
})
