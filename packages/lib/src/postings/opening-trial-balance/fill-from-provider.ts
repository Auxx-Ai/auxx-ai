// packages/lib/src/postings/opening-trial-balance/fill-from-provider.ts
//
// Suggest the opening trial balance from the connected accounting provider's
// balance sheet (plans/accounting/tasks/19-opening-balances-from-the-provider.md
// section 4.5): read the draft context, read the provider's balance sheet as
// of the cutover date, run the pure planner, save the result through the
// existing write path, and record the three inventory settings plus
// provenance.
//
// 🛑 Never posts. The fill is a SUGGESTION, never an authority (brief 19
// DECIDED 1): every cell stays editable after it lands, nothing here calls
// `postOpeningTrialBalance`, and the person still presses Continue.
//
// No permission checks. The router asserts `ledgerControl` - the same rung
// `ledgerOpening.save` runs on, because this writes the same draft (brief 19
// section 4.5).

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type { SettingKey } from '../../settings/catalog'
import { batchUpdateOrganizationSettings } from '../../settings/settings-service'
import type { SettingValue } from '../../settings/types'
import { ACCOUNT_ROLES } from '../build-entry'
import { type ProviderOpeningFillPlan, planProviderOpeningFill } from '../opening-fill-plan'
import { resolveAccountingProvider } from '../provider'
import { INVENTORY_ROLES } from '../regime'
import { loadRoleAccountCodes } from '../resolve-roles'
import { assertAccountingSetupUnfrozen } from '../settled-periods'
import { OPENING_TRIAL_BALANCE_FREEZE_KEY, rowsToJournalEntryLines } from './client'
import { guard } from './guard'
import { readOpeningTrialBalance } from './reads'
import { requireCutoverDate, saveOpeningTrialBalance } from './writes'

const logger = createScopedLogger('postings:opening-trial-balance')

/** What the fill did, for the "Suggest from QuickBooks" card. */
export interface ProviderOpeningFillOutcome {
  /** The cutover date the provider's balance sheet was read at. */
  asOf: string
  /** The provider's reporting currency, already checked against the org's. */
  currency: string
  filledCount: number
  unmatched: ProviderOpeningFillPlan['unmatched']
  unmatchedTotalMinor: number
  netIncome: ProviderOpeningFillPlan['netIncome']
  differenceMinor: number
  inventoryGapMinor: number
  inventoryRefusal: string | null
  /**
   * The three provider figures as written to `accounting.qboOpening*`, so the
   * browser can patch its own settings store without a round trip. All null
   * when `inventoryRefusal` is set, because nothing was written then.
   */
  inventory: ProviderOpeningFillPlan['inventory']
}

/**
 * Suggest the opening trial balance from the connected accounting provider,
 * and save it through the existing write path.
 *
 * @throws {UnprocessableEntityError} when nothing is connected, the provider
 *   reports no balances, the cutoff or book timezone is unset, or the
 *   provider's currency does not match the organization's.
 * @throws {ConflictError} once the ledger holds a standing entry - the
 *   baseline is frozen (`assertAccountingSetupUnfrozen`), asserted up front so
 *   nothing is fetched from the provider for a frozen org.
 */
export async function fillOpeningTrialBalanceFromProvider(
  db: Database,
  organizationId: string,
  userId: string
): Promise<Result<ProviderOpeningFillOutcome, Error>> {
  return guard(
    async () => {
      // Checked before anything is fetched from the provider - a frozen org
      // has nothing to suggest into.
      await assertAccountingSetupUnfrozen(organizationId, [OPENING_TRIAL_BALANCE_FREEZE_KEY])

      // Reuses `saveOpeningTrialBalance`'s own cutover check, so the refusal
      // wording (and the fix it names) is identical on both doors.
      const cutoverDate = await requireCutoverDate(db, organizationId)

      const view = await readOpeningTrialBalance(db, organizationId)
      if (view.isErr()) throw view.error

      const provider = await resolveAccountingProvider(organizationId)
      const sheetResult = await provider.readProviderOpeningBalances(organizationId, cutoverDate)
      if (sheetResult.isErr()) throw sheetResult.error
      const sheet = sheetResult.value

      if (!sheet) {
        throw new UnprocessableEntityError(
          'No accounting system is connected, so there is nothing to suggest from.',
          { organizationId }
        )
      }
      if (!sheet.hasData || sheet.rows.length === 0) {
        throw new UnprocessableEntityError(
          'The connected accounting system reports no balances to suggest from.',
          { organizationId, providerId: provider.id }
        )
      }
      if (sheet.currency !== view.value.currency) {
        throw new UnprocessableEntityError(
          `The accounting provider reports its balance sheet in ${sheet.currency}, and this ` +
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
        loadRoleAccountCodes(db, organizationId, [
          ...INVENTORY_ROLES,
          ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS,
        ]),
      ])
      if (mappingsResult.isErr()) throw mappingsResult.error

      const roleAccounts = new Map(
        [...roleAccountRows].map(([role, account]) => [role, account.glAccountId])
      )

      const plan = planProviderOpeningFill({
        sheet,
        rows: view.value.rows,
        accountMap: mappingsResult.value,
        roleAccounts,
      })

      // The existing write path, unchanged - including
      // `assertAccountingSetupUnfrozen` and the freeze it enforces again, and
      // the locked rows at their count value (section 4.3's 🔧: without them
      // Finalize would refuse with the locked-row ConflictError).
      const saved = await saveOpeningTrialBalance(db, organizationId, userId, {
        lines: rowsToJournalEntryLines(plan.rows),
      })
      if (saved.isErr()) throw saved.error

      const settings: Array<{ key: SettingKey; value: SettingValue }> = [
        { key: 'accounting.openingSource', value: 'provider' },
        { key: 'accounting.openingSourceAsOf', value: cutoverDate },
      ]
      // Never write the three qboOpening* settings out of a refused inventory
      // split (section 4.3.1) - the fill leaves them exactly as they were.
      if (!plan.inventoryRefusal) {
        settings.push(
          {
            key: 'accounting.qboOpeningRawMaterials',
            value: plan.inventory.qboOpeningRawMaterials,
          },
          { key: 'accounting.qboOpeningWip', value: plan.inventory.qboOpeningWip },
          {
            key: 'accounting.qboOpeningFinishedGoods',
            value: plan.inventory.qboOpeningFinishedGoods,
          }
        )
      }
      await batchUpdateOrganizationSettings({ organizationId, settings, db })

      // `batchUpdateOrganizationSettings` is called from lib here, not from the
      // settings router, so this write must fire its own cache invalidation or
      // the difference gate on the opening trial balance page reads a stale
      // `orgSettings` cache entry. `broadcastUserKeys: true` is load-bearing:
      // the browser's settings store is hydrated from the per-user
      // `userSettings` cache, which the `org.settings.changed` edge reaches
      // only when the event broadcasts to user keys. Found by driving - with
      // `{ orgId }` alone a full reload still showed the manual instruction
      // (brief 19 section 4.5;
      // `settings/seed-document-business.ts:67` is the precedent this copies).
      const { onCacheEvent } = await import('../../cache/invalidate')
      await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

      logger.info('Suggested the opening trial balance from the accounting provider', {
        organizationId,
        asOf: cutoverDate,
        filledCount: plan.filledCount,
        unmatchedCount: plan.unmatched.length,
        unmatchedTotalMinor: plan.unmatchedTotalMinor,
        inventoryRefused: plan.inventoryRefusal !== null,
      })

      return {
        asOf: cutoverDate,
        currency: sheet.currency,
        filledCount: plan.filledCount,
        unmatched: plan.unmatched,
        unmatchedTotalMinor: plan.unmatchedTotalMinor,
        netIncome: plan.netIncome,
        differenceMinor: plan.differenceMinor,
        inventoryGapMinor: plan.inventoryGapMinor,
        inventoryRefusal: plan.inventoryRefusal,
        inventory: plan.inventory,
      }
    },
    'Failed to suggest the opening trial balance from the accounting provider',
    { organizationId }
  )
}
