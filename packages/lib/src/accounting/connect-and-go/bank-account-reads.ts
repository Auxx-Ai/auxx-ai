// packages/lib/src/accounting/connect-and-go/bank-account-reads.ts

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { listBankAccounts } from '../banking/reads'
import { listChartAccounts } from '../ledger/roles/role-map'
import { resolveAccountingProvider } from '../providers/provider'
import { planBankAccounts } from './bank-account-plan'
import type { BankAccountPlan } from './client'
import { guard } from './guard'

/**
 * Read-only: the `bank_account` records setup would create or link for the chart's bank-subtype
 * accounts. Nothing is written; `applyBankAccountProposals` takes the accepted keys.
 * No permission checks - the router asserts.
 */
export async function planBankAccountsFromProvider(
  db: Database,
  params: { organizationId: string }
): Promise<Result<BankAccountPlan, Error>> {
  const { organizationId } = params
  return guard(
    async () => {
      const provider = await resolveAccountingProvider(organizationId)
      const [chart, bankAccounts, mappings] = await Promise.all([
        listChartAccounts(db, organizationId),
        listBankAccounts(db, { organizationId, includeArchived: true }),
        provider.listAccountMappings(organizationId),
      ])
      if (chart.isErr()) throw chart.error
      if (bankAccounts.isErr()) throw bankAccounts.error
      if (mappings.isErr()) throw mappings.error

      return planBankAccounts({
        chart: chart.value,
        providerAccountIds: mappings.value,
        bankAccounts: bankAccounts.value,
      })
    },
    'Failed to plan bank accounts from the accounting provider',
    { organizationId }
  )
}
