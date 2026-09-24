// packages/lib/src/accounting/connect-and-go/prepare.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { getCachedMembersByUserIds } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { importChartFromProvider, mintMissingRoleAccounts } from '../ledger/chart/chart-import'
import { ROLES_REQUIRED_BY_ENABLED_POSTING_TYPES } from '../ledger/roles/regime'
import { listChartAccounts, listRoleMap } from '../ledger/roles/role-map'
import { FINALIZED_SETUP_STATE, isValidTimeZone } from '../ledger/setup/setup-readiness'
import type { ChartImportResult } from '../ledger/types'
import { confirmSuggestedIdentities } from '../providers/account-identities'
import {
  NONE_PROVIDER_ID,
  resolveAccountingProvider,
  supportsCreatingProviderAccounts,
} from '../providers/provider'
import { autoRouteRails } from './auto-route-rails'
import { planBankAccountsFromProvider } from './bank-account-reads'
import type {
  ConnectAndGoFailure,
  ConnectAndGoPrepareReport,
  ConnectAndGoRoleQuestion,
} from './client'
import { proposeCutover } from './cutover'
import { guard } from './guard'
import { withSetupLock } from './lock'
import { listProviderAccountsToCreate } from './provider-accounts-to-create'

const logger = createScopedLogger('accounting:connect-and-go')

const PREPARE_SETTING_KEYS = [
  'accounting.setupState',
  'accounting.cutoffPeriod',
  'accounting.bookTimeZone',
  'accounting.fiscalYearStartMonth',
  'accounting.exportMode',
] as const

/**
 * Everything setup can do from the connected provider before anyone answers: the chart, rails,
 * the accounts Finish will create there, and the bank-account plan. Reads the provider only,
 * posts nothing and writes no setting. Idempotent. A step's refusal is reported and the rest run.
 * No permission checks - the router asserts. See plans/accounting/tasks/105-connect-and-go.md §4.
 */
export async function prepareConnectAndGo(
  db: Database,
  params: { organizationId: string; actorUserId: string; today?: Date }
): Promise<Result<ConnectAndGoPrepareReport, Error>> {
  const { organizationId } = params
  return guard(
    () => withSetupLock(db, organizationId, () => prepareLocked(db, params)),
    'Failed to prepare accounting setup from the connected provider',
    { organizationId }
  )
}

async function prepareLocked(
  db: Database,
  params: { organizationId: string; actorUserId: string; today?: Date }
): Promise<ConnectAndGoPrepareReport> {
  const { organizationId, actorUserId } = params
  const provider = await resolveAccountingProvider(organizationId)
  if (provider.id === NONE_PROVIDER_ID) {
    throw new UnprocessableEntityError(
      'No accounting system is connected, so there is nothing to set up from.',
      { organizationId }
    )
  }

  const failures: ConnectAndGoFailure[] = []
  const fail = (step: ConnectAndGoFailure['step'], error: Error) => {
    failures.push({ step, message: error.message })
    logger.warn('Connect and go: step refused', { organizationId, step, error: error.message })
  }

  const settings = await readOrganizationSettings(organizationId, PREPARE_SETTING_KEYS, db)
  const finalized = settings['accounting.setupState'] === FINALIZED_SETUP_STATE

  // 1. The company's own settings: the fiscal year and lock date proposed below.
  let company: ConnectAndGoPrepareReport['company'] = null
  if (provider.readCompanySettings) {
    const read = await provider.readCompanySettings(organizationId)
    if (read.isErr()) fail('company_settings', read.error)
    else company = read.value
  }

  // Proposed only; Finish writes what the person confirms. Once finalized the saved value stands.
  const savedFiscalMonth = asMonthNumber(settings['accounting.fiscalYearStartMonth'])
  const fiscalYearStartMonth =
    (finalized ? savedFiscalMonth : asMonthNumber(company?.fiscalYearStartMonth)) ??
    savedFiscalMonth ??
    1
  const bookTimeZone =
    settings['accounting.bookTimeZone']?.trim() ||
    (await actorTimeZone(organizationId, actorUserId))

  const proposedCutover = proposeCutover({
    currentCutoffPeriod: settings['accounting.cutoffPeriod'] ?? null,
    lockDate: company?.lockDate ?? null,
    bookTimeZone,
    today: params.today ?? new Date(),
  })

  // 2. The chart: the whole provider chart into an empty one; otherwise link what the
  // matcher pairs first, so the refresh does not import a second copy of those accounts.
  let chart: ConnectAndGoPrepareReport['chart'] = null
  const existing = await listChartAccounts(db, organizationId)
  if (existing.isErr()) fail('chart', existing.error)
  else {
    const empty = existing.value.length === 0
    let suggestionsLinked = 0
    if (!empty) {
      const linked = await confirmSuggestedIdentities(db, { organizationId, actorUserId })
      if (linked.isErr()) fail('chart', linked.error)
      else suggestionsLinked = linked.value.confirmed
    }
    const imported = await importChartFromProvider(db, {
      organizationId,
      actorUserId,
      refreshOnly: !empty,
    })
    if (imported.isErr()) fail('chart', imported.error)
    else chart = { mode: empty ? 'full' : 'refresh', suggestionsLinked, result: imported.value }
  }

  // 3. Rails, before the account list: a rail mints clearing and fee accounts of ours.
  const rails = await autoRouteRails(db, { organizationId, actorUserId, today: params.today })
  if (rails.isErr()) fail('rails', rails.error)

  // 4. Roles the enabled posting types need that nothing fits: mint the default account.
  // Ambiguous roles are a person's question, and minting without a chart would duplicate one.
  let rolesMinted: ConnectAndGoPrepareReport['rolesMinted'] = []
  if (chart) {
    const ambiguous = new Set(chart.result.rolesAmbiguous.map((row) => row.role))
    const minted = await mintMissingRoleAccounts(db, {
      organizationId,
      actorUserId,
      roles: ROLES_REQUIRED_BY_ENABLED_POSTING_TYPES.filter((role) => !ambiguous.has(role)),
    })
    if (minted.isErr()) fail('roles', minted.error)
    else rolesMinted = minted.value
  }

  // 5. Our accounts the provider has no counterpart for, the ones just minted included. Only
  // listed: nothing is written to the provider before Finish.
  let providerAccountsToCreate: ConnectAndGoPrepareReport['providerAccountsToCreate'] = null
  if (supportsCreatingProviderAccounts(provider)) {
    const listed = await listProviderAccountsToCreate(db, organizationId)
    if (listed.isErr()) fail('provider_accounts', listed.error)
    else providerAccountsToCreate = listed.value
  }

  // 6. Bank accounts are proposed, never created here.
  const bankAccounts = await planBankAccountsFromProvider(db, { organizationId })
  if (bankAccounts.isErr()) fail('bank_accounts', bankAccounts.error)

  const roles = chart ? await roleQuestions(db, organizationId, provider, chart.result) : []
  if (roles instanceof Error) fail('roles', roles)

  const report: ConnectAndGoPrepareReport = {
    preparedAt: new Date().toISOString(),
    finalized,
    company,
    fiscalYearStartMonth,
    bookTimeZone,
    exportMode: settings['accounting.exportMode'] === 'summary' ? 'summary' : 'transaction',
    proposedCutover,
    chart,
    rolesMinted,
    rails: rails.isOk() ? rails.value : null,
    providerAccountsToCreate,
    bankAccounts: bankAccounts.isOk() ? bankAccounts.value : null,
    questions: {
      roles: roles instanceof Error ? [] : roles,
      rails: rails.isOk() ? rails.value.questions : [],
      bankAccounts: bankAccounts.isOk() ? bankAccounts.value.proposals : [],
    },
    failures,
  }
  logger.info('Connect and go prepared', {
    organizationId,
    chartMode: chart?.mode ?? null,
    failures: failures.length,
  })
  return report
}

/** The ambiguous roles still unmapped, each with our accounts linked to the provider's candidates. */
async function roleQuestions(
  db: Database,
  organizationId: string,
  provider: Awaited<ReturnType<typeof resolveAccountingProvider>>,
  imported: ChartImportResult
): Promise<ConnectAndGoRoleQuestion[] | Error> {
  if (imported.rolesAmbiguous.length === 0) return []
  const [roleMap, mappings] = await Promise.all([
    listRoleMap(db, organizationId),
    provider.listAccountMappings(organizationId),
  ])
  if (roleMap.isErr()) return roleMap.error
  if (mappings.isErr()) return mappings.error

  const unmapped = new Set(
    roleMap.value.filter((row) => row.state === 'unmapped').map((row) => row.role)
  )
  const glByProvider = new Map<string, string>()
  for (const [glAccountId, providerAccountId] of mappings.value)
    glByProvider.set(providerAccountId, glAccountId)

  return imported.rolesAmbiguous
    .filter((row) => unmapped.has(row.role))
    .map((row) => ({
      role: row.role,
      candidateAccountIds: row.providerAccountIds.flatMap((id) => {
        const glAccountId = glByProvider.get(id)
        return glAccountId ? [glAccountId] : []
      }),
    }))
}

/** The connecting person's own timezone, when they set a valid one. */
async function actorTimeZone(organizationId: string, userId: string): Promise<string | null> {
  const [member] = await getCachedMembersByUserIds(organizationId, [userId])
  const zone = member?.user?.preferredTimezone?.trim()
  return zone && isValidTimeZone(zone) ? zone : null
}

function asMonthNumber(value: unknown): number | null {
  const month = Number(value)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null
}
