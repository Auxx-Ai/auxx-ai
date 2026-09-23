// packages/lib/src/accounting/provider-matches/assess.ts
// Brief 102 M3: match each provider-authored Payment and Deposit in a range to a record of
// ours. Only an invoice link matches on its own (and adopts); a pairing found by amount and
// date is a suggestion a person accepts.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { AuxxError } from '../../errors'
import { INVOICE_OBJECT_TYPE } from '../export/payloads/invoice'
import { recordInvoicePayment } from '../money/invoice-payments/record-payment'
import type { AccountingProvider, ProviderTransactionLinks } from '../providers/provider'
import {
  type EntryToAssess,
  findOurSentDocument,
  isSubjectSent,
  listEntriesToAssess,
  listPayoutCandidates,
  listReceiptsOnInvoice,
  railOfClearingAccount,
} from './reads'
import { type ProviderMatchWrite, writeProviderMatch } from './writes'

const logger = createScopedLogger('provider-matches')

/** How far either side of their deposit date a payout of ours may fall. */
const PAYOUT_WINDOW_DAYS = 5

export interface AssessProviderMatchesInput {
  bookId: string
  from: string
  to: string
  provider: AccountingProvider
  /** `providerAccountId -> glAccountId`, the map the translation used. */
  glAccountIdByProviderId: ReadonlyMap<string, string>
  actorUserId?: string
}

export interface AssessProviderMatchesOutcome {
  assessed: number
  adopted: number
  suggested: number
  /** One line per entry whose provider object could not be read; it is assessed next run. */
  failures: string[]
}

export async function assessProviderMatches(
  db: Database,
  organizationId: string,
  input: AssessProviderMatchesInput
): Promise<Result<AssessProviderMatchesOutcome, Error>> {
  const outcome: AssessProviderMatchesOutcome = {
    assessed: 0,
    adopted: 0,
    suggested: 0,
    failures: [],
  }
  const readLinks = input.provider.readTransactionLinks?.bind(input.provider)
  if (!readLinks) return ok(outcome)

  try {
    const entries = await listEntriesToAssess(db, organizationId, input)
    for (const entry of entries) {
      const links = await readLinks(organizationId, {
        txnType: entry.providerTxnType,
        txnId: entry.providerTxnId,
      })
      if (links.isErr()) {
        outcome.failures.push(links.error.message)
        continue
      }
      const next = links.value
        ? entry.providerTxnType === 'Payment'
          ? await assessPayment(db, organizationId, entry, links.value, input.actorUserId)
          : await assessDeposit(db, organizationId, entry, links.value, input)
        : ({ state: null, reason: 'not_ours' } satisfies ProviderMatchWrite)
      await writeProviderMatch(db, organizationId, entry.id, next)
      outcome.assessed += 1
      if (next.reason === 'adopted') outcome.adopted += 1
      if (next.state === 'suggested') outcome.suggested += 1
    }
    return ok(outcome)
  } catch (error) {
    logger.error('Provider match assessment failed', { organizationId, error })
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

function debitTotal(entry: EntryToAssess): number {
  return entry.lines
    .filter((line) => line.direction === 'debit')
    .reduce((total, line) => total + line.amountMinor, 0)
}

async function assessPayment(
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  actorUserId: string | undefined
): Promise<ProviderMatchWrite> {
  const invoices = links.linked.filter((linked) => linked.txnType === 'Invoice')
  if (invoices.length === 0) return { state: null, reason: 'not_ours' }
  if (invoices.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }

  const document = await findOurSentDocument(db, organizationId, {
    objectType: INVOICE_OBJECT_TYPE,
    providerObjectId: invoices[0]!.txnId,
  })
  if (!document) return { state: null, reason: 'not_ours' }
  if (document.sourceKind !== 'invoice') return { state: 'unmatchable', reason: 'order_invoice' }

  const amountMinor = debitTotal(entry)
  const receipts = await listReceiptsOnInvoice(db, organizationId, {
    invoiceInstanceId: document.sourceId,
    amountMinor,
  })
  if (receipts.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }
  if (receipts.length === 1) {
    const sent = await isSubjectSent(db, organizationId, {
      sourceKind: 'money_transaction',
      sourceId: receipts[0]!,
    })
    return {
      state: 'suggested',
      reason: sent ? 'duplicate_sent' : 'ours_unsent',
      kind: 'money_transaction',
      matchedId: receipts[0]!,
    }
  }

  // Only theirs: record it against our invoice so it reads paid; their entry is the posting.
  try {
    const userId = actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))
    const recorded = await recordInvoicePayment(db, {
      organizationId,
      userId,
      invoiceInstanceId: document.sourceId,
      amountMinor,
      date: entry.txnDate,
      method: 'other',
      reference: entry.docNumber ?? undefined,
      note: `Recorded from ${entry.providerTxnType} ${entry.providerTxnId} in the connected books`,
      commandKey: `provider-match:${entry.id}`,
      providerLedgerEntryId: entry.id,
    })
    return {
      state: 'matched',
      reason: 'adopted',
      kind: 'money_transaction',
      matchedId: recorded.moneyTransactionId,
    }
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    return { state: 'unmatchable', reason: 'cannot_adopt' }
  }
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

async function assessDeposit(
  db: Database,
  organizationId: string,
  entry: EntryToAssess,
  links: ProviderTransactionLinks,
  input: AssessProviderMatchesInput
): Promise<ProviderMatchWrite> {
  const onRails: Array<{ railId: string; amountMinor: number }> = []
  for (const line of links.codedLines) {
    const glAccountId = input.glAccountIdByProviderId.get(line.providerAccountId)
    const railId = glAccountId ? await railOfClearingAccount(db, organizationId, glAccountId) : null
    if (railId) onRails.push({ railId, amountMinor: line.amountMinor })
  }
  if (onRails.length === 0) return { state: null, reason: 'not_ours' }
  if (onRails.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }

  const payouts = await listPayoutCandidates(db, organizationId, {
    railId: onRails[0]!.railId,
    amountMinor: onRails[0]!.amountMinor,
    from: shiftDate(entry.txnDate, -PAYOUT_WINDOW_DAYS),
    to: shiftDate(entry.txnDate, PAYOUT_WINDOW_DAYS),
  })
  if (payouts.length === 0) return { state: 'pending', reason: 'no_payout' }
  if (payouts.length > 1) return { state: 'unmatchable', reason: 'ambiguous' }
  const sent = await isSubjectSent(db, organizationId, {
    sourceKind: 'payout',
    sourceId: payouts[0]!,
  })
  return {
    state: 'suggested',
    reason: sent ? 'duplicate_sent' : 'ours_unsent',
    kind: 'payout',
    matchedId: payouts[0]!,
  }
}
