// packages/lib/src/accounting/ledger/chart/chart-import.ts
//
// The WRITER half of importing a provider's chart of accounts (brief 16 §2.2):
// resolves the connected provider, reads its chart and the org's, runs the pure
// `planChartImport`, creates each planned account through `createChartAccount`
// - already in parent-before-child order - and sets its identity right after,
// repoints an already-imported account whose provider row gained a parent
// (CHART-HIERARCHY §6), assigns the unambiguous roles with `source: 'import'`,
// then (on a full import) creates the role-bearing core accounts the provider
// has no candidate for, with no identity. `db` first, `Result` from neverthrow,
// no permission checks: the caller asserts access.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { onCacheEvent } from '../../../cache'
import {
  AuxxError,
  NotFoundError,
  UniqueValueConflictError,
  UnprocessableEntityError,
} from '../../../errors'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from '../../providers/provider'
import { readProviderChart } from '../../providers/provider-chart'
import type { AccountRole } from '../builders/entry'
import { withAccountingCommitLock } from '../post/accounting-commit-lock'
import { insertDefaultRoleAssignmentsIfAbsent } from '../roles/role-assignments'
import { listChartAccounts, listRoleMap } from '../roles/role-map'
import type { ChartImportResult } from '../types'
import type { GlAccountSubtypeValue } from './account-subtype'
import { planChartImport } from './chart-import-plan'
import { createChartAccount, updateChartAccount } from './chart-write'
import type { DefaultChartAccount, GlAccountTypeValue } from './default-chart'
import { type CodedAccount, nextAccountCode } from './next-account-code'

const logger = createScopedLogger('postings:chart-import')

export interface ImportChartOptions {
  organizationId: string
  actorUserId: string
  /** `true` on the Chart tab's refresh: adds, never creates the missing core. */
  refreshOnly?: boolean
}

export interface ImportProviderAccountsOptions {
  organizationId: string
  actorUserId: string
  /** The provider's own account ids; unknown ids refuse, inactive ones are skipped. */
  providerAccountIds: readonly string[]
}

/** What one call to `createChartAccount` needs, stripped of plan bookkeeping. */
interface CreateAccountInput {
  code: string | null
  name: string
  accountType: GlAccountTypeValue
  subtype: GlAccountSubtypeValue | null
  /** Resolved to a `glAccountId` already, or omitted when the provider's parent has no counterpart here yet. */
  parentId?: string | null
}

/**
 * Import the connected provider's chart into the org's, creating only what the
 * org does not already have. Idempotent: a second run creates nothing and
 * reports `alreadyImported`. Refuses `UnprocessableEntityError` when nothing is
 * connected, because an empty import is not a success.
 */
export async function importChartFromProvider(
  db: Database,
  options: ImportChartOptions
): Promise<Result<ChartImportResult, Error>> {
  return runImport(db, options.organizationId, options.actorUserId, {
    mintCore: !options.refreshOnly,
  })
}

/**
 * Import just these provider accounts (plus any unlinked parents they nest
 * under), link each, and assign the unambiguous roles they carry. Never mints
 * core accounts; already-linked ids count as `alreadyImported`.
 */
export async function importProviderAccounts(
  db: Database,
  options: ImportProviderAccountsOptions
): Promise<Result<ChartImportResult, Error>> {
  if (options.providerAccountIds.length === 0) return ok(emptyResult())
  return runImport(db, options.organizationId, options.actorUserId, {
    mintCore: false,
    only: new Set(options.providerAccountIds),
  })
}

function emptyResult(): ChartImportResult {
  return {
    created: 0,
    alreadyImported: 0,
    skippedInactive: 0,
    rolesAssigned: [],
    rolesAmbiguous: [],
    coreCreated: [],
    nestedUnder: 0,
  }
}

async function runImport(
  db: Database,
  organizationId: string,
  actorUserId: string,
  scope: { mintCore: boolean; only?: ReadonlySet<string> }
): Promise<Result<ChartImportResult, Error>> {
  try {
    const provider = await resolveAccountingProvider(organizationId)

    // Import is an explicit "read the provider now", so drop the cached chart first.
    await onCacheEvent('accounting.provider-chart.changed', { orgId: organizationId })
    const providerChart = await readProviderChart(organizationId)
    if (providerChart.isErr()) return err(providerChart.error)
    const providerAccounts = providerChart.value

    // Nothing connected (the null provider answers `ok([])`) and an empty chart
    // both leave nothing to do, and saying so beats reporting zero of everything.
    if (providerAccounts.length === 0) {
      throw new UnprocessableEntityError(
        provider.id === NONE_PROVIDER_ID
          ? 'No accounting system is connected. Connect one before importing its chart of accounts.'
          : 'The connected accounting system reports no accounts to import.',
        { organizationId, providerId: provider.id }
      )
    }

    if (scope.only) {
      const known = new Set(providerAccounts.map((account) => account.id))
      const unknown = [...scope.only].filter((id) => !known.has(id))
      if (unknown.length > 0) {
        throw new NotFoundError(
          'The connected accounting system does not report one or more of these accounts.',
          { organizationId, providerAccountIds: unknown }
        )
      }
    }

    const [mappings, chart, roleMap] = await Promise.all([
      provider.listAccountMappings(organizationId),
      listChartAccounts(db, organizationId),
      listRoleMap(db, organizationId),
    ])
    if (mappings.isErr()) return err(mappings.error)
    if (chart.isErr()) return err(chart.error)
    if (roleMap.isErr()) return err(roleMap.error)

    const plan = planChartImport(providerAccounts, chart.value, mappings.value, roleMap.value, {
      onlyProviderAccountIds: scope.only,
    })

    // `providerAccountId -> glAccountId` over every existing link, grown as this
    // run creates accounts, so a child or a role candidate finds its account here.
    const glAccountIdByProviderId = new Map<string, string>()
    for (const [glAccountId, providerAccountId] of mappings.value) {
      glAccountIdByProviderId.set(providerAccountId, glAccountId)
    }
    const codedAccounts: CodedAccount[] = [...chart.value]

    let created = 0
    let nestedUnder = 0
    for (const item of plan.create) {
      const parentId = item.providerParentId
        ? glAccountIdByProviderId.get(item.providerParentId)
        : undefined
      if (parentId) nestedUnder++
      const account = await createAccount(db, organizationId, actorUserId, { ...item, parentId })
      glAccountIdByProviderId.set(item.providerAccount.id, account.id)
      codedAccounts.push(account)
      created++

      const mapped = await provider.setAccountMapping({
        orgId: organizationId,
        glAccountId: account.id,
        providerAccountId: item.providerAccount.id,
        actorUserId,
      })
      if (mapped.isErr()) return err(mapped.error)
    }

    for (const item of plan.reparent) {
      const parentId = glAccountIdByProviderId.get(item.providerParentId)
      if (!parentId) continue
      const updated = await updateChartAccount(db, {
        organizationId,
        accountId: item.glAccountId,
        parentId,
        ...(item.leafName ? { name: item.leafName } : {}),
        actorUserId,
      })
      if (updated.isErr()) {
        // A refusal (type mismatch, depth) must not abort a refresh after partial writes.
        logger.warn('Chart import: reparent refused, left where it was', {
          organizationId,
          glAccountId: item.glAccountId,
          message: updated.error.message,
        })
        continue
      }
      nestedUnder++
    }

    const rolesAssigned: AccountRole[] = []
    for (const candidate of plan.roleCandidates) {
      const glAccountId = glAccountIdByProviderId.get(candidate.providerAccountId)
      if (!glAccountId) continue
      const inserted = await insertRoleAssignment(
        db,
        organizationId,
        candidate.role,
        glAccountId,
        'import'
      )
      if (inserted) rolesAssigned.push(candidate.role)
    }

    const coreCreated: DefaultChartAccount[] = []
    if (scope.mintCore) {
      for (const account of plan.missingCore) {
        if (!account.role) continue
        const minted = await createAccount(db, organizationId, actorUserId, {
          code: mintedCode(account, codedAccounts),
          name: account.name,
          accountType: account.accountType,
          subtype: account.subtype ?? null,
        })
        codedAccounts.push(minted)
        const inserted = await insertRoleAssignment(
          db,
          organizationId,
          account.role,
          minted.id,
          'seed'
        )
        if (inserted) coreCreated.push(account)
      }
    }

    return ok({
      created,
      alreadyImported: plan.alreadyImported.length,
      skippedInactive: plan.skippedInactive.length,
      rolesAssigned,
      rolesAmbiguous: plan.ambiguousRoles,
      coreCreated,
      nestedUnder,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to import the provider chart', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * The default code when the chart is numbered, else the next free one in its
 * hundred (`4020` -> `4020-4099`); null for an unnumbered chart or a full band.
 */
function mintedCode(account: DefaultChartAccount, chart: readonly CodedAccount[]): string | null {
  const start = Number(account.code)
  if (!Number.isInteger(start)) return null
  const end = Math.floor(start / 100) * 100 + 99
  const code = nextAccountCode({ start, end, label: `${start}-${end}` }, chart)
  return code.isOk() ? code.value : null
}

/**
 * Create one account, falling back to no code on a collision: a duplicated
 * provider account number must not abort the whole import.
 */
async function createAccount(
  db: Database,
  organizationId: string,
  actorUserId: string,
  input: CreateAccountInput
): Promise<{ id: string; code: string | null }> {
  const result = await createChartAccount(db, {
    organizationId,
    actorUserId,
    code: input.code,
    name: input.name,
    accountType: input.accountType,
    subtype: input.subtype,
    parentId: input.parentId,
  })
  if (result.isOk()) return result.value

  if (input.code && result.error instanceof UniqueValueConflictError) {
    logger.warn('Chart import: code collision, created the account without a code', {
      organizationId,
      code: input.code,
      name: input.name,
    })
    const retried = await createChartAccount(db, {
      organizationId,
      actorUserId,
      code: null,
      name: input.name,
      accountType: input.accountType,
      subtype: input.subtype,
      parentId: input.parentId,
    })
    if (retried.isOk()) return retried.value
    throw retried.error
  }

  throw result.error
}

/**
 * Point one role at one account, `ON CONFLICT (organizationId, role) DO
 * NOTHING`, so it is safe to repeat and against a concurrent editor.
 *
 * @returns whether a row was inserted - false means the role was already mapped.
 */
async function insertRoleAssignment(
  db: Database,
  organizationId: string,
  role: AccountRole,
  glAccountId: string,
  source: 'import' | 'seed'
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    const inserted = await insertDefaultRoleAssignmentsIfAbsent(
      tx,
      organizationId,
      [{ role, glAccountId }],
      source
    )
    return inserted > 0
  })
}
