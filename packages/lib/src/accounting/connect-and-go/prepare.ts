// packages/lib/src/accounting/connect-and-go/prepare.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { getCachedMembersByUserIds } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { batchUpdateOrganizationSettings } from '../../settings/settings-service'
import { importChartFromProvider, mintMissingRoleAccounts } from '../ledger/chart/chart-import'
import { ROLES_REQUIRED_BY_ENABLED_POSTING_TYPES } from '../ledger/roles/regime'
import { listChartAccounts, listRoleMap } from '../ledger/roles/role-map'
import { FINALIZED_SETUP_STATE, isValidTimeZone } from '../ledger/setup/setup-readiness'
import type { ChartImportResult } from '../ledger/types'
import { confirmSuggestedIdentities, listAccountIdentities } from '../providers/account-identities'
import { createProviderAccounts } from '../providers/create-provider-accounts'
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

const logger = createScopedLogger('accounting:connect-and-go')

const PREPARE_SETTING_KEYS = [
  'accounting.setupState',
  'accounting.cutoffPeriod',
  'accounting.bookTimeZone',
  'accounting.fiscalYearStartMonth',
] as const

/**
 * Everything setup can do from the connected provider before anyone answers: fiscal year and
 * timezone, the chart, rails, pushing our own accounts, and the bank-account plan. Posts
 * nothing and writes no cutover. Idempotent. A step's refusal is reported and the rest run.
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

  // 1. The company's own settings: fiscal year, and a timezone while none is set.
  let company: ConnectAndGoPrepareReport['company'] = null
  if (provider.readCompanySettings) {
    const read = await provider.readCompanySettings(organizationId)
    if (read.isErr()) fail('company_settings', read.error)
    else company = read.value
  }

  const writes: { key: (typeof PREPARE_SETTING_KEYS)[number]; value: string }[] = []
  const fiscalMonth = company?.fiscalYearStartMonth ?? null
  let fiscalYearStartMonthWritten: number | null = null
  if (
    fiscalMonth &&
    fiscalMonth >= 1 &&
    fiscalMonth <= 12 &&
    String(settings['accounting.fiscalYearStartMonth'] ?? '') !== String(fiscalMonth)
  ) {
    writes.push({ key: 'accounting.fiscalYearStartMonth', value: String(fiscalMonth) })
    fiscalYearStartMonthWritten = fiscalMonth
  }

  let bookTimeZone = settings['accounting.bookTimeZone']?.trim() || null
  let bookTimeZoneWritten = false
  if (!bookTimeZone) {
    const actorZone = await actorTimeZone(organizationId, actorUserId)
    if (actorZone) {
      writes.push({ key: 'accounting.bookTimeZone', value: actorZone })
      bookTimeZone = actorZone
      bookTimeZoneWritten = true
    }
  }
  if (writes.length > 0) {
    await batchUpdateOrganizationSettings({ organizationId, settings: writes, db })
  }

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

  // 3. Rails, before the push: a rail mints clearing and fee accounts of ours.
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

  // 5. Our accounts the provider has no counterpart for, the ones just minted included.
  let providerAccounts: ConnectAndGoPrepareReport['providerAccounts'] = null
  if (supportsCreatingProviderAccounts(provider)) {
    const identities = await listAccountIdentities(db, organizationId)
    if (identities.isErr()) fail('provider_accounts', identities.error)
    else {
      const unlinked = identities.value.rows
        .filter((row) => !row.providerAccountId && !row.suggestion && !row.account.isArchived)
        .map((row) => row.account.id)
      if (unlinked.length > 0) {
        const pushed = await createProviderAccounts(db, {
          organizationId,
          glAccountIds: unlinked,
          actorUserId,
        })
        if (pushed.isErr()) fail('provider_accounts', pushed.error)
        else {
          providerAccounts = {
            created: pushed.value.created.length,
            failed: pushed.value.failed ?? null,
          }
          if (pushed.value.failed) fail('provider_accounts', new Error(pushed.value.failed.message))
        }
      } else providerAccounts = { created: 0, failed: null }
    }
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
    fiscalYearStartMonthWritten,
    bookTimeZone,
    bookTimeZoneWritten,
    proposedCutover,
    chart,
    rolesMinted,
    rails: rails.isOk() ? rails.value : null,
    providerAccounts,
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
