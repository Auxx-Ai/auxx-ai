// packages/lib/src/accounting/connect-and-go/complete.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, BadRequestError } from '../../errors'
import { postOpeningInventoryAdjustment } from '../../inventory/receiving/opening-inventory-adjustment'
import { readOrganizationSettings } from '../../settings/read'
import { batchUpdateOrganizationSettings } from '../../settings/settings-service'
import { ACCOUNT_ROLES } from '../ledger/builders/entry'
import { importProviderAccounts } from '../ledger/chart/chart-import'
import { assertAccountingSetupUnfrozen } from '../ledger/periods/settled-periods'
import { didLedgerAccept } from '../ledger/post/ledger-accepted'
import { setRoleAssignment } from '../ledger/roles/role-map'
import {
  FINALIZED_SETUP_STATE,
  isMonthKey,
  isValidTimeZone,
  readOpeningFromNothing,
} from '../ledger/setup/setup-readiness'
import { fillOpeningTrialBalanceFromProvider } from '../opening/fill-from-provider'
import { finalizeAccountingSetup } from '../opening/finalize-setup'
import { readOpeningPresence } from '../opening/reads'
import { createProviderAccounts } from '../providers/create-provider-accounts'
import { resolveAccountingProvider, supportsCreatingProviderAccounts } from '../providers/provider'
import { requestAccountingRecovery } from '../work-items/recovery'
import { activateBookConnectionForSetup } from './activate-book-connection'
import { applyBankAccountProposals } from './bank-account-writes'
import type {
  ConnectAndGoAnswers,
  ConnectAndGoCompleteReport,
  ConnectAndGoCompleteStep,
} from './client'
import { withSetupLock } from './lock'
import { listProviderAccountsToCreate } from './provider-accounts-to-create'

const logger = createScopedLogger('accounting:connect-and-go')

/** A step's own refusal: stops the run with this sentence. */
class StepFailure extends Error {}

/**
 * The person has confirmed the cutover and answered the questions: write them, create our
 * unlinked accounts in the provider, activate exports, fill the opening from the provider, finalize and post it, then the inventory
 * adjustment. Stops at the first refusal and keeps what landed; every step is idempotent, so
 * calling again resumes. Refuses outright only on a malformed cutover or timezone.
 * No permission checks - the router asserts.
 */
export async function completeConnectAndGo(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    cutoffPeriod: string
    answers?: ConnectAndGoAnswers
  }
): Promise<Result<ConnectAndGoCompleteReport, Error>> {
  const answers = params.answers ?? {}
  const cutoffPeriod = params.cutoffPeriod.trim()
  if (!isMonthKey(cutoffPeriod)) {
    return err(new BadRequestError(`"${cutoffPeriod}" is not a YYYY-MM month.`))
  }
  const answeredZone = answers.bookTimeZone?.trim() || null
  if (answeredZone && !isValidTimeZone(answeredZone)) {
    return err(new BadRequestError(`"${answeredZone}" is not a valid IANA timezone.`))
  }
  try {
    return ok(
      await withSetupLock(db, params.organizationId, () =>
        completeLocked(db, { ...params, cutoffPeriod, answers, answeredZone })
      )
    )
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

async function completeLocked(
  db: Database,
  params: {
    organizationId: string
    actorUserId: string
    cutoffPeriod: string
    answers: ConnectAndGoAnswers
    answeredZone: string | null
  }
): Promise<ConnectAndGoCompleteReport> {
  const { organizationId, actorUserId, cutoffPeriod, answers, answeredZone } = params
  const report: ConnectAndGoCompleteReport = {
    completed: false,
    steps: [],
    failedAt: null,
    message: null,
    bankAccounts: null,
    providerAccounts: null,
    bookConnection: null,
    opening: null,
    finalize: null,
    inventoryAdjustment: null,
  }

  const run = async (
    step: ConnectAndGoCompleteStep,
    body: () => Promise<string | null | { skipped: string }>
  ): Promise<boolean> => {
    try {
      const outcome = await body()
      report.steps.push(
        outcome && typeof outcome === 'object'
          ? { step, status: 'skipped', detail: outcome.skipped }
          : { step, status: 'done', detail: outcome }
      )
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.steps.push({ step, status: 'failed', detail: message })
      report.failedAt = step
      report.message = message
      if (!(error instanceof StepFailure) && !(error instanceof AuxxError))
        logger.error('Connect and go: step failed', { organizationId, step, error: message })
      return false
    }
  }

  const settings = await readOrganizationSettings(
    organizationId,
    [
      'accounting.setupState',
      'accounting.cutoffPeriod',
      'accounting.bookTimeZone',
      'accounting.openingFromNothing',
    ] as const,
    db
  )
  const finalized = settings['accounting.setupState'] === FINALIZED_SETUP_STATE

  const steps: Array<
    [ConnectAndGoCompleteStep, () => Promise<string | null | { skipped: string }>]
  > = [
    [
      'cutover',
      async () => {
        const writes: {
          key: 'accounting.cutoffPeriod' | 'accounting.bookTimeZone'
          value: string
        }[] = []
        if (settings['accounting.cutoffPeriod']?.trim() !== cutoffPeriod)
          writes.push({ key: 'accounting.cutoffPeriod', value: cutoffPeriod })
        if (!settings['accounting.bookTimeZone']?.trim()) {
          if (!answeredZone) throw new StepFailure('Choose the timezone your books are kept in.')
          writes.push({ key: 'accounting.bookTimeZone', value: answeredZone })
        }
        if (writes.length === 0) return { skipped: 'Already set' }
        await assertAccountingSetupUnfrozen(
          organizationId,
          writes.map((write) => write.key)
        )
        await batchUpdateOrganizationSettings({ organizationId, settings: writes, db })
        return null
      },
    ],
    [
      'roles',
      async () => {
        const roles = answers.roles ?? []
        if (roles.length === 0) return { skipped: 'Nothing to answer' }
        for (const answer of roles) {
          const set = await setRoleAssignment(db, {
            organizationId,
            role: answer.role,
            glAccountId: answer.glAccountId,
            actorUserId,
          })
          if (set.isErr()) throw set.error
        }
        return `${roles.length} mapped`
      },
    ],
    [
      'rail_banks',
      async () => {
        const banks = answers.railBanks ?? []
        if (banks.length === 0) return { skipped: 'Nothing to answer' }
        for (const answer of banks) {
          const set = await setRoleAssignment(db, {
            organizationId,
            role: ACCOUNT_ROLES.BANK,
            paymentGatewayId: answer.paymentGatewayId,
            glAccountId: answer.glAccountId,
            actorUserId,
          })
          if (set.isErr()) throw set.error
        }
        return `${banks.length} mapped`
      },
    ],
    [
      'bank_accounts',
      async () => {
        const accept = answers.acceptBankAccounts ?? []
        if (accept.length === 0) return { skipped: 'None accepted' }
        const applied = await applyBankAccountProposals(db, { organizationId, actorUserId, accept })
        if (applied.isErr()) throw applied.error
        report.bankAccounts = applied.value
        const failed = applied.value.failed[0]
        if (failed) throw new StepFailure(failed.message)
        return `${applied.value.created.length} created, ${applied.value.linked.length} linked`
      },
    ],
    [
      // Before the book connection and the fill: both need every account linked.
      'provider_accounts',
      async () => {
        const provider = await resolveAccountingProvider(organizationId)
        if (!supportsCreatingProviderAccounts(provider))
          return { skipped: 'The accounting system cannot create accounts' }
        const listed = await listProviderAccountsToCreate(db, organizationId)
        if (listed.isErr()) throw listed.error
        if (listed.value.length === 0) return { skipped: 'Every account is linked' }
        const pushed = await createProviderAccounts(db, {
          organizationId,
          glAccountIds: listed.value.map((row) => row.glAccountId),
          actorUserId,
        })
        if (pushed.isErr()) throw pushed.error
        report.providerAccounts = { created: pushed.value.created.length }
        if (pushed.value.failed) throw new StepFailure(pushed.value.failed.message)
        return `${pushed.value.created.length} created`
      },
    ],
    [
      'book_connection',
      async () => {
        const activated = await activateBookConnectionForSetup(db, { organizationId, actorUserId })
        if (activated.isErr()) throw activated.error
        report.bookConnection = activated.value
        return activated.value.activated
          ? `Exports start ${activated.value.exportFromDate}`
          : { skipped: 'Already active' }
      },
    ],
    [
      'opening',
      async () => {
        if (finalized) return { skipped: 'Setup is already finalized' }
        if (readOpeningFromNothing(settings as Record<string, unknown>))
          return { skipped: 'The books start from nothing' }
        if ((await readOpeningPresence(db, organizationId)).posted)
          return { skipped: 'Already posted' }
        const filled = await fillOpening(db, organizationId, actorUserId)
        report.opening = filled
        return `${filled.filledCount} accounts filled`
      },
    ],
    [
      'finalize',
      async () => {
        const done = await finalizeAccountingSetup(db, { organizationId, actorUserId })
        if (done.isErr()) throw done.error
        const opening = done.value.opening
        report.finalize = {
          finalizedNow: done.value.finalizedNow,
          openingStatus: opening?.status ?? null,
        }
        if (opening && !didLedgerAccept(opening))
          throw new StepFailure(opening.error ?? `The opening entry came back ${opening.status}.`)
        return done.value.finalizedNow ? 'Finalized' : { skipped: 'Already finalized' }
      },
    ],
    [
      'inventory_adjustment',
      async () => {
        const adjusted = await postOpeningInventoryAdjustment(db, { organizationId, actorUserId })
        if (adjusted.isErr()) throw adjusted.error
        const post = adjusted.value.post
        report.inventoryAdjustment = {
          differenceMinor: adjusted.value.difference.differenceMinor,
          status: post?.status ?? null,
        }
        if (!post) return { skipped: 'Inventory already agrees' }
        if (!didLedgerAccept(post))
          throw new StepFailure(post.error ?? `The adjustment came back ${post.status}.`)
        return 'Posted'
      },
    ],
  ]

  for (const [step, body] of steps) {
    if (!(await run(step, body))) break
  }

  report.completed = report.failedAt === null
  // The backlog after the cutover starts draining now rather than at the next scheduled page.
  if (report.completed) await requestAccountingRecovery(organizationId)
  logger.info('Connect and go completed', {
    organizationId,
    completed: report.completed,
    failedAt: report.failedAt,
  })
  return report
}

/** Fill the opening; on unmatched provider balances import those accounts and try once more. */
async function fillOpening(
  db: Database,
  organizationId: string,
  actorUserId: string
): Promise<{ filledCount: number; differenceMinor: number; importedAccounts: number }> {
  const first = await fillOpeningTrialBalanceFromProvider(db, organizationId, actorUserId)
  if (first.isOk())
    return {
      filledCount: first.value.filledCount,
      differenceMinor: first.value.differenceMinor,
      importedAccounts: 0,
    }

  const providerAccountIds = unmatchedProviderAccountIds(first.error)
  if (providerAccountIds.length === 0) throw first.error

  const imported = await importProviderAccounts(db, {
    organizationId,
    actorUserId,
    providerAccountIds,
  })
  if (imported.isErr()) throw imported.error

  const second = await fillOpeningTrialBalanceFromProvider(db, organizationId, actorUserId)
  if (second.isErr()) throw second.error
  return {
    filledCount: second.value.filledCount,
    differenceMinor: second.value.differenceMinor,
    importedAccounts: imported.value.created,
  }
}

function unmatchedProviderAccountIds(error: Error): string[] {
  if (!(error instanceof AuxxError)) return []
  const ids = (error.details as { providerAccountIds?: unknown }).providerAccountIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}
