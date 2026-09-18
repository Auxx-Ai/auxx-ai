// packages/lib/src/money/customer-money/accounting.ts

/**
 * A channel customer receipt against an ORDER.
 *
 * ```
 *   Dr <the gateway's clearing account>   the receipt
 *       Cr accounts_receivable              the shipped part
 *       Cr customer_deposits                the advance part
 *       Cr sales_tax_payable                per jurisdiction
 * ```
 *
 * The split comes from the order's recognition timeline, which is what a
 * standalone invoice does not need - see `invoices/receipt-accounting.ts`.
 *
 * Subject the `MoneyTransaction`, parent the order, counterparty the customer;
 * `storeId` is the feed's `FinancialSourceAccount` and `railId` the gateway the
 * receipt routed through (TARGET §1).
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toLedgerMinor } from '../../accounting/ledger/builders/basis-hash'
import { buildEntry } from '../../accounting/ledger/builders/entry'
import { resolvePeriodLock } from '../../accounting/ledger/periods/period-lock'
import { readAutoPostMode } from '../../accounting/ledger/post/auto-post'
import { didLedgerAccept } from '../../accounting/ledger/post/ledger-accepted'
import { postEntry } from '../../accounting/ledger/post/post-entry'
import { findLiveSubjectPosting } from '../../accounting/ledger/reads/list-postings'
import { resolveRoles } from '../../accounting/ledger/roles/resolve-roles'
import { isAccountingEnabled } from '../../accounting/ledger/setup/accounting-enabled'
import { FINALIZED_SETUP_STATE } from '../../accounting/ledger/setup/setup-readiness'
import type {
  BuiltEntry,
  GlPostingLineInput,
  GlPostingSourceInput,
  PostResult,
} from '../../accounting/ledger/types'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import {
  listCustomerReceiptAccountingCandidates,
  readCustomerReceiptAccountingSource,
} from './receipt-accounting'
import { allocateRecognitionTaxComponents } from './recognition'
import { readOrderRecognitionFactsInTx } from './recognition-facts'
import {
  readOrderRecognitionSource,
  requireCompleteOrderRecognitionSource,
} from './recognition-source'

const logger = createScopedLogger('customer-receipt-accounting')

export interface CustomerReceiptAccountingResult {
  status: 'accepted' | 'blocked' | 'skipped'
  glPostingId?: string
  reason?: string
}

type Command = {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
  automatic?: boolean
}

interface PreparedReceipt {
  entry: BuiltEntry
  sources: GlPostingSourceInput[]
  storeId: string | null
  railId: string | null
}

async function prepareReceipt(
  tx: Transaction,
  input: Command,
  zone: string | null,
  cutoff: string | null
): Promise<PreparedReceipt> {
  if (!zone) throw new UnprocessableEntityError('Book time zone is not configured')
  const source = await readCustomerReceiptAccountingSource(
    tx,
    input.organizationId,
    input.moneyTransactionId,
    zone
  )
  const facts = await readOrderRecognitionFactsInTx(tx, input.organizationId, source.orderId)
  if (source.money.partyInstanceId && source.money.partyInstanceId !== facts.customerInstanceId)
    throw new UnprocessableEntityError('Receipt customer differs from the order customer')
  const timeline = requireCompleteOrderRecognitionSource(
    await readOrderRecognitionSource(tx, {
      organizationId: input.organizationId,
      orderId: source.orderId,
      orderNetMinor: (facts.subtotal + facts.shipping).toString(),
      orderTaxMinor: facts.tax.toString(),
      bookTimeZone: zone,
      target: { kind: 'receipt', id: source.money.id },
    })
  )
  const allocation = timeline.target
  if (!allocation)
    throw new UnprocessableEntityError('Receipt is absent from the recognition timeline')
  const taxShares = allocateRecognitionTaxComponents(timeline.allocations, facts.taxComponents).get(
    source.money.id
  )!
  const taxComponents = facts.taxComponents.map((component) => ({
    ...component,
    amountMinor: taxShares.find((share) => share.componentKey === component.componentKey)!
      .amountMinor,
  }))
  // 58 §5.6: the clearing account resolves through the receipt's rail scope,
  // exactly like a fulfillment's, not the gateway's own (retired) field.
  const clearing = await resolveRoles(tx, input.organizationId, ['clearing'], {
    rail: source.paymentGatewayId,
  })
  if (clearing.isErr()) throw clearing.error
  const clearingGlAccountId = clearing.value.get('clearing')!.glAccountId

  const dimensions = {
    sourceProvider: source.sourceProvider,
    ...(facts.channel ? { channel: facts.channel } : {}),
    sourceStoreId: source.sourceStoreId,
    paymentGatewayId: source.paymentGatewayId,
    orderId: source.orderId,
  }
  const base = { sourceType: 'money_transaction', sourceId: source.money.id, dimensions }
  const money = (amount: string) => toLedgerMinor(amount, 'USD', 2)
  const lines: GlPostingLineInput[] = [
    {
      ...base,
      glAccountId: clearingGlAccountId,
      direction: 'debit',
      amount: money(allocation.amountMinor),
      sortOrder: 0,
      memo: 'Customer payment received',
    },
  ]
  if (BigInt(allocation.receivableMinor) > 0n)
    lines.push({
      ...base,
      accountRole: 'accounts_receivable',
      direction: 'credit',
      amount: money(allocation.receivableMinor),
      sortOrder: lines.length,
      counterpartyType: 'customer',
      counterpartyId: facts.customerInstanceId,
      memo: 'Payment applied to shipped order',
    })
  if (BigInt(allocation.depositMinor) > 0n)
    lines.push({
      ...base,
      accountRole: 'customer_deposits',
      direction: 'credit',
      amount: money(allocation.depositMinor),
      sortOrder: lines.length,
      memo: 'Advance payment held for shipment',
    })
  for (const tax of taxComponents)
    if (BigInt(tax.amountMinor) > 0n)
      lines.push({
        ...base,
        accountRole: 'sales_tax_payable',
        direction: 'credit',
        amount: money(tax.amountMinor),
        sortOrder: lines.length,
        dimensions: {
          ...dimensions,
          jurisdiction: tax.jurisdiction!,
          taxComponentId: tax.componentKey,
        },
        memo: 'Sales tax on advance payment',
      })
  const label = [source.storeDomain, source.sourceExternalId, source.gatewayName, facts.channel]
    .filter(Boolean)
    .join(' / ')
  for (const line of lines) line.memo = `${label}: ${line.memo}`

  const entry = buildEntry({
    postingType: 'payment',
    periodKey: source.effectiveDate,
    txnDate: source.effectiveDate,
    lines,
  })

  if (cutoff && entry.txnDate.slice(0, 7) <= cutoff)
    throw new UnprocessableEntityError(`Receipt is before the accounting opening cutoff ${cutoff}`)

  return {
    entry,
    storeId: source.sourceStoreId,
    railId: source.paymentGatewayId,
    sources: [
      { sourceKind: 'money_transaction', sourceId: source.money.id, linkRole: 'subject' },
      { sourceKind: 'order', sourceId: source.orderId, linkRole: 'parent' },
      {
        sourceKind: 'contact',
        sourceId: facts.customerInstanceId,
        linkRole: 'counterparty',
      },
    ],
  }
}

/**
 * Post one channel receipt. A refusal is a `blocked` result, never a throw: the
 * sweep retries it and the money model is unaffected either way.
 */
export async function postCustomerReceiptAccounting(
  db: Database,
  input: Command
): Promise<CustomerReceiptAccountingResult> {
  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: 'money_transaction',
    sourceId: input.moneyTransactionId,
  })
  if (live.isErr()) return { status: 'blocked', reason: live.error.message }
  if (live.value) return { status: 'accepted', glPostingId: live.value.id }

  if (!(await isAccountingEnabled(db, input.organizationId)))
    return { status: 'skipped', reason: 'Accounting is not enabled' }

  let prepared: PreparedReceipt
  try {
    const settings = await readOrganizationSettings(input.organizationId, [
      'accounting.setupState',
      'accounting.bookTimeZone',
      'accounting.cutoffPeriod',
    ] as const)
    if (settings['accounting.setupState'] !== FINALIZED_SETUP_STATE)
      throw new UnprocessableEntityError(
        'Finalize accounting setup before posting customer payments'
      )
    prepared = await db.transaction((tx) =>
      prepareReceipt(
        tx,
        input,
        settings['accounting.bookTimeZone'],
        settings['accounting.cutoffPeriod']
      )
    )
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    logger.warn('A customer receipt could not be prepared', {
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      error: error.message,
    })
    return { status: 'blocked', reason: error.message }
  }

  const lock = await resolvePeriodLock(input.organizationId)
  const post: PostResult = await postEntry(db, {
    organizationId: input.organizationId,
    entry: prepared.entry,
    actorUserId: input.actorUserId,
    lock,
    memo: `Customer payment - movement ${input.moneyTransactionId}`,
    sources: prepared.sources,
    scope: { store: prepared.storeId ?? undefined, rail: prepared.railId ?? undefined },
    storeId: prepared.storeId,
    railId: prepared.railId,
    mode: await readAutoPostMode(input.organizationId, 'receipt'),
  })
  if (!didLedgerAccept(post))
    return { status: 'blocked', reason: post.error ?? `The ledger answered ${post.status}` }
  return { status: 'accepted', glPostingId: post.glPostingId }
}

/** Bounded recovery retries repaired receipt evidence without starving later movements. */
export async function sweepCustomerReceiptAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
) {
  const started = Date.now()
  const ids = await listCustomerReceiptAccountingCandidates(
    db,
    input.organizationId,
    Math.min(input.limit ?? 100, 500)
  )
  const counts = { scanned: 0, accepted: 0, blocked: 0, skipped: 0 }
  for (const moneyTransactionId of ids) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    const result = await postCustomerReceiptAccounting(db, {
      organizationId: input.organizationId,
      moneyTransactionId,
      automatic: true,
    })
    counts.scanned++
    counts[result.status]++
  }
  return counts
}
