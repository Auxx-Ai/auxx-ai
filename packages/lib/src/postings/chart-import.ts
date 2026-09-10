// packages/lib/src/postings/chart-import.ts
//
// The WRITER half of importing a provider's chart of accounts (brief 16 §2.2):
// resolves the connected provider, reads its chart and the org's, runs the pure
// `planChartImport`, creates each planned account through `createChartAccount`
// and sets its identity right after, assigns the unambiguous roles with
// `source: 'import'`, then (unless `refreshOnly`) creates the role-bearing core
// accounts the provider lacks, uncoded and with no identity. `db` first,
// `Result` from neverthrow, no permission checks: the router asserts
// `ledgerControl` and calls.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { AuxxError, UniqueValueConflictError, UnprocessableEntityError } from '../errors'
import type { GlAccountSubtypeValue } from './account-subtype'
import type { AccountRole } from './build-entry'
import { planChartImport } from './chart-import-plan'
import { createChartAccount } from './chart-write'
import type { DefaultChartAccount, GlAccountTypeValue } from './default-chart'
import { NONE_PROVIDER_ID, resolveAccountingProvider } from './provider'
import { listChartAccounts, listRoleMap } from './role-map'
import type { ChartImportResult } from './types'

const logger = createScopedLogger('postings:chart-import')

export interface ImportChartOptions {
  organizationId: string
  actorUserId: string
  /** `true` on the Chart tab's refresh: adds, never creates the missing core. */
  refreshOnly?: boolean
}

/** What one call to `createChartAccount` needs, stripped of plan bookkeeping. */
interface CreateAccountInput {
  code: string | null
  name: string
  accountType: GlAccountTypeValue
  subtype: GlAccountSubtypeValue | null
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
  const { organizationId, actorUserId, refreshOnly } = options

  try {
    const provider = await resolveAccountingProvider(organizationId)

    const providerChart = await provider.listProviderAccounts(organizationId)
    if (providerChart.isErr()) return err(providerChart.error)
    const providerAccounts = providerChart.value

    // An empty import is not a success (16 §2.2) - whether because nothing is
    // connected (the null provider always answers `ok([])`) or because a
    // connected provider's chart happens to be empty, there is nothing to do
    // and saying so beats silently reporting zero of everything.
    if (providerAccounts.length === 0) {
      throw new UnprocessableEntityError(
        provider.id === NONE_PROVIDER_ID
          ? 'No accounting system is connected. Connect one before importing its chart of accounts.'
          : 'The connected accounting system reports no accounts to import.',
        { organizationId, providerId: provider.id }
      )
    }

    const [mappings, chart, roleMap] = await Promise.all([
      provider.listAccountMappings(organizationId),
      listChartAccounts(db, organizationId),
      listRoleMap(db, organizationId),
    ])
    if (mappings.isErr()) return err(mappings.error)
    if (chart.isErr()) return err(chart.error)
    if (roleMap.isErr()) return err(roleMap.error)

    const plan = planChartImport(providerAccounts, chart.value, mappings.value, roleMap.value)

    // `providerAccountId -> glAccountId`, seeded with what already existed and
    // grown as this run creates accounts - a role candidate resolved against a
    // provider account created moments ago needs to find it here too.
    const glAccountIdByProviderId = new Map<string, string>(
      plan.alreadyImported.map((row) => [row.providerAccount.id, row.glAccountId])
    )

    let created = 0
    for (const item of plan.create) {
      const glAccountId = await createAccount(db, organizationId, actorUserId, item)
      glAccountIdByProviderId.set(item.providerAccount.id, glAccountId)
      created++

      const mapped = await provider.setAccountMapping({
        orgId: organizationId,
        glAccountId,
        providerAccountId: item.providerAccount.id,
        actorUserId,
      })
      if (mapped.isErr()) return err(mapped.error)
    }

    // Roles this run can resolve without asking - `source: 'import'`, only for
    // a role `planChartImport` already filtered to `unmapped`. `ON CONFLICT DO
    // NOTHING` (inside `insertRoleAssignment`) is what makes this idempotent
    // against a concurrent editor, the same guarantee `assignSeededRoles` gives
    // the provisioner.
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

    // The role-bearing core accounts QuickBooks lacks (16 DECIDED): created
    // uncoded, with no identity, `source: 'seed'` - never on a refresh, which
    // only adds what the provider already has.
    const coreCreated: DefaultChartAccount[] = []
    if (!refreshOnly) {
      for (const account of plan.missingCore) {
        if (!account.role) continue
        const glAccountId = await createAccount(db, organizationId, actorUserId, {
          code: null,
          name: account.name,
          accountType: account.accountType,
          subtype: account.subtype ?? null,
        })
        const inserted = await insertRoleAssignment(
          db,
          organizationId,
          account.role,
          glAccountId,
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
      coreCreated,
    })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to import the provider chart', { error, organizationId })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Create one account, falling back to no code on a collision.
 *
 * 🛑 **A duplicated `AcctNum` in the provider's chart must not abort the whole
 * import.** `createChartAccount`'s code gate is check-then-write (`chart-write.ts`);
 * on a collision this creates the account anyway, without the code, and logs a
 * warning naming it - reported to the caller only as one more row under
 * `created`, per brief 16 §2.2, because `ChartImportResult` carries counts, not
 * a list of what went almost right.
 */
async function createAccount(
  db: Database,
  organizationId: string,
  actorUserId: string,
  input: CreateAccountInput
): Promise<string> {
  const result = await createChartAccount(db, {
    organizationId,
    actorUserId,
    code: input.code,
    name: input.name,
    accountType: input.accountType,
    subtype: input.subtype,
  })
  if (result.isOk()) return result.value.id

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
    })
    if (retried.isOk()) return retried.value.id
    throw retried.error
  }

  throw result.error
}

/**
 * Point one role at one account, `ON CONFLICT (organizationId, role) DO
 * NOTHING` - the same upsert-free insert `assignSeededRoles` uses, for the
 * same reason: the unique index that makes the resolver's answer unambiguous
 * is the same index that makes this safe to repeat.
 *
 * @returns whether a row was actually inserted - false means the role was
 * already mapped by the time this ran, and the caller must not count it.
 */
async function insertRoleAssignment(
  db: Database,
  organizationId: string,
  role: AccountRole,
  glAccountId: string,
  source: 'import' | 'seed'
): Promise<boolean> {
  const inserted = await db
    .insert(schema.GlRoleAssignment)
    .values({ organizationId, role, glAccountId, source })
    .onConflictDoNothing({
      target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
    })
    .returning({ id: schema.GlRoleAssignment.id })

  return inserted.length > 0
}
