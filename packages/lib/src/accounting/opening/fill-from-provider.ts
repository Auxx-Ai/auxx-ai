// packages/lib/src/accounting/opening/fill-from-provider.ts
//
// Fill the opening from the connected accounting provider's balance sheet at the
// cutover, inventory included (plans/accounting/tasks/103 §5a). Saves the draft; never
// posts - `finalizeAccountingSetup` does. No permission checks: the router asserts
// `ledgerControl`.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { formatCurrency } from '@auxx/utils'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { batchUpdateOrganizationSettings } from '../../settings/settings-service'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { assertAccountingSetupUnfrozen } from '../ledger/periods/settled-periods'
import { loadRoleAccountCodes } from '../ledger/roles/resolve-roles'
import { resolveAccountingProvider } from '../providers/provider'
import { OPENING_TRIAL_BALANCE_FREEZE_KEY, rowsToJournalEntryLines } from './client'
import { guard } from './guard'
import { type ProviderOpeningFillPlan, planProviderOpeningFill } from './opening-fill-plan'
import { readOpeningTrialBalance } from './reads'
import { requireCutoverDate, saveOpeningTrialBalance } from './writes'

const logger = createScopedLogger('postings:opening-trial-balance')

/** What the fill saved. */
export interface ProviderOpeningFillOutcome {
  /** The cutover date the provider's balance sheet was read at. */
  asOf: string
  /** The provider's reporting currency, already checked against the org's. */
  currency: string
  filledCount: number
  netIncome: ProviderOpeningFillPlan['netIncome']
  differenceMinor: number
}

/**
 * Fill the opening draft from the connected provider's balance sheet at the cutover.
 *
 * @throws {UnprocessableEntityError} when nothing is connected, the provider reports no
 *   balances, the cutover is unset, the currencies differ, or a provider account carrying
 *   a balance has no account of ours - `details.providerAccountIds` lists those, for a
 *   targeted import. Nothing is saved on a refusal.
 * @throws {ConflictError} once the ledger holds a standing entry.
 */
/** `details.reason` when the provider has no data at the cutover: its books start after it. */
export const NO_PROVIDER_BALANCES = 'no_provider_balances'

export async function fillOpeningTrialBalanceFromProvider(
  db: Database,
  organizationId: string,
  userId: string
): Promise<Result<ProviderOpeningFillOutcome, Error>> {
  return guard(
    async () => {
      await assertAccountingSetupUnfrozen(organizationId, [OPENING_TRIAL_BALANCE_FREEZE_KEY])
      const cutoverDate = await requireCutoverDate(db, organizationId)

      const view = await readOpeningTrialBalance(db, organizationId)
      if (view.isErr()) throw view.error

      const provider = await resolveAccountingProvider(organizationId)
      const sheetResult = await provider.readProviderBalances(organizationId, cutoverDate)
      if (sheetResult.isErr()) throw sheetResult.error
      const sheet = sheetResult.value

      if (!sheet) {
        throw new UnprocessableEntityError(
          'No accounting system is connected, so there is nothing to fill the opening from.',
          { organizationId }
        )
      }
      if (!sheet.hasData || sheet.rows.length === 0) {
        throw new UnprocessableEntityError(
          'The connected accounting system reports no balances at the cutover.',
          { organizationId, providerId: provider.id, reason: NO_PROVIDER_BALANCES }
        )
      }
      if (sheet.currency !== view.value.currency) {
        throw new UnprocessableEntityError(
          `The accounting system reports its balance sheet in ${sheet.currency}, and this ` +
            `organization's ledger currency is ${view.value.currency}. A currency mismatch needs ` +
            'a conversation, not a silent conversion.',
          {
            organizationId,
            providerCurrency: sheet.currency,
            organizationCurrency: view.value.currency,
          }
        )
      }

      const [mappingsResult, roleAccountRows] = await Promise.all([
        provider.listAccountMappings(organizationId),
        loadRoleAccountCodes(db, organizationId, [ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS]),
      ])
      if (mappingsResult.isErr()) throw mappingsResult.error

      const plan = planProviderOpeningFill({
        sheet,
        rows: view.value.rows,
        accountMap: mappingsResult.value,
        roleAccounts: new Map(
          [...roleAccountRows].map(([role, account]) => [role, account.glAccountId])
        ),
      })

      if (plan.unmatched.length > 0) {
        const named = plan.unmatched
          .map((row) => `${row.name} (${formatCurrency(row.minorSigned)})`)
          .join(', ')
        throw new UnprocessableEntityError(
          `${plan.unmatched.length} account(s) in the accounting system carry a balance at the ` +
            `cutover and have no account in your chart: ${named}. Import them into the chart, ` +
            'then fill the opening again.',
          {
            organizationId,
            providerAccountIds: plan.unmatched.flatMap((row) =>
              row.providerAccountId ? [row.providerAccountId] : []
            ),
            names: plan.unmatched.map((row) => row.name),
          }
        )
      }

      const saved = await saveOpeningTrialBalance(db, organizationId, userId, {
        lines: rowsToJournalEntryLines(plan.rows),
      })
      if (saved.isErr()) throw saved.error

      await batchUpdateOrganizationSettings({
        organizationId,
        settings: [
          { key: 'accounting.openingSource', value: 'provider' },
          { key: 'accounting.openingSourceAsOf', value: cutoverDate },
        ],
        db,
      })

      logger.info('Filled the opening from the accounting provider', {
        organizationId,
        asOf: cutoverDate,
        filledCount: plan.filledCount,
        differenceMinor: plan.differenceMinor,
      })

      return {
        asOf: cutoverDate,
        currency: sheet.currency,
        filledCount: plan.filledCount,
        netIncome: plan.netIncome,
        differenceMinor: plan.differenceMinor,
      }
    },
    'Failed to fill the opening balances from the accounting provider',
    { organizationId }
  )
}
