// packages/lib/src/accounting/provider-matches/adopt.ts
// Recording a provider's payment against a bill of ours (102 D1): shared by the matcher and Accept.

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { AuxxError } from '../../errors'
import { recordVendorPayment } from '../money/vendor-payments/record-payment'
import type { EntryToAssess } from './reads'

/** The person who pressed sync or Accept, else the org's system user. */
export async function adoptingUser(
  organizationId: string,
  actorUserId: string | undefined
): Promise<string> {
  return actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))
}

/**
 * Record their payment against our bill so it reads paid; their entry is the posting. Returns
 * the movement id; an `AuxxError` is our bill refusing it, anything else throws.
 */
export async function adoptVendorPayment(
  db: Database,
  organizationId: string,
  entry: Pick<EntryToAssess, 'id' | 'providerTxnType' | 'providerTxnId' | 'txnDate' | 'docNumber'>,
  input: { vendorBillInstanceId: string; amountMinor: number; actorUserId?: string }
): Promise<Result<string, AuxxError>> {
  try {
    const recorded = await recordVendorPayment(db, {
      organizationId,
      userId: await adoptingUser(organizationId, input.actorUserId),
      vendorBillInstanceId: input.vendorBillInstanceId,
      amountMinor: input.amountMinor,
      date: entry.txnDate,
      method: 'other',
      reference: entry.docNumber,
      note: `Recorded from ${entry.providerTxnType} ${entry.providerTxnId} in the connected books`,
      commandKey: `provider-match:${entry.id}`,
      providerLedgerEntryId: entry.id,
    })
    return ok(recorded.moneyTransactionId)
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    return err(error)
  }
}
