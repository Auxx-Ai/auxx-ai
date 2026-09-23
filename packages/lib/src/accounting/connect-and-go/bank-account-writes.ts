// packages/lib/src/accounting/connect-and-go/bank-account-writes.ts

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { createBankAccount, updateBankAccount } from '../banking/writes'
import { planBankAccountsFromProvider } from './bank-account-reads'
import type { BankAccountApplyReport } from './client'

/**
 * Create or link only the accepted proposals, each re-checked against a fresh plan: a key the
 * current state no longer proposes is skipped, which is what makes a repeat call a no-op.
 * No permission checks - the router asserts.
 */
export async function applyBankAccountProposals(
  db: Database,
  params: { organizationId: string; actorUserId: string; accept: readonly string[] }
): Promise<Result<BankAccountApplyReport, Error>> {
  const { organizationId, actorUserId } = params
  const plan = await planBankAccountsFromProvider(db, { organizationId })
  if (plan.isErr()) return err(plan.error)
  const byKey = new Map(plan.value.proposals.map((proposal) => [proposal.key as string, proposal]))

  const report: BankAccountApplyReport = { created: [], linked: [], skipped: [], failed: [] }
  for (const key of new Set(params.accept)) {
    const proposal = byKey.get(key)
    if (!proposal) {
      report.skipped.push({ key, reason: 'no_longer_applies' })
      continue
    }

    if (proposal.kind === 'create') {
      const created = await createBankAccount(db, {
        organizationId,
        actorUserId,
        name: proposal.name,
        last4: proposal.last4,
        type: 'depository',
        glAccountId: proposal.glAccountId,
      })
      if (created.isErr()) report.failed.push({ key: proposal.key, message: created.error.message })
      else
        report.created.push({
          key: proposal.key,
          bankAccountId: created.value.id,
          glAccountId: proposal.glAccountId,
        })
      continue
    }

    const linked = await updateBankAccount(db, {
      organizationId,
      actorUserId,
      bankAccountId: proposal.bankAccountId,
      glAccountId: proposal.glAccountId,
    })
    if (linked.isErr()) report.failed.push({ key: proposal.key, message: linked.error.message })
    else
      report.linked.push({
        key: proposal.key,
        bankAccountId: proposal.bankAccountId,
        glAccountId: proposal.glAccountId,
      })
  }
  return ok(report)
}
