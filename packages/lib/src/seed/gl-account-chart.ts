// packages/lib/src/seed/gl-account-chart.ts
//
// Seeds `DEFAULT_CHART_OF_ACCOUNTS` into one organization as `gl_account`
// EntityInstances. Called from entity migration 108 for every org that has the
// `gl_account` def, which is the only door today.
//
// WHY THE CHART LIVES IN `lib/postings/` AND THE WRITER LIVES HERE
//
// `postings/default-chart.ts` is pure data — no database, no io — because
// `postings/` already owns the account vocabulary (`ACCOUNT_ROLES`) that the
// chart's `role` column maps onto. `seed -> lib` is the sanctioned dependency
// direction and `lib -> seed` is forbidden, so the writer imports the constant
// and never the reverse.
//
// THE FOUR RULES THIS FILE EXISTS TO KEEP
//
//  1. **Idempotent on `code`.** A code the org already holds is skipped whole —
//     never updated, never inserted a second time. `gl_account_code` is unique,
//     but its gate is a check-then-write `SELECT ... LIMIT 1` with no lock and
//     no index behind it, and it excludes archived rows. A duplicate `1310`
//     would make the role resolver's fail-closed behaviour fire on EVERY
//     posting, not just the one that touches 1310.
//  2. **Single writer, sequential.** No parallel fan-out over the chart and no
//     parallel fan-out over orgs for the same code: a concurrent race is the
//     one case the check-then-write gate does not cover.
//  3. **Never touch an account the org already has.** Not the name, not the
//     type, not the role. A chart is a bookkeeper's document (decision `G7`) —
//     they renumber, rename and deactivate, and re-running the seed must be a
//     no-op over their edits.
//  4. **`role` is omitted, never written as null, when the row has none.** An
//     absent role writes no `FieldValue` row at all, which is exactly what makes
//     `unique: true` on a nullable field safe: twenty-odd role-less accounts
//     have nothing to collide on. Writing an explicit null would route through
//     `deleteValue` and cost a round trip to achieve the same absence.
//
//  5. **Assert the roles actually landed, then throw.** `UnifiedCrudHandler`
//     silently DROPS a value whose field it cannot resolve, and it resolves
//     fields from the ORG CACHE — so a `gl_account_role` created moments earlier
//     in the same migration pass is invisible to it and the create succeeds
//     anyway. That is not hypothetical: the first run of this seed wrote 784
//     accounts across 28 orgs with every field populated except the role, and
//     logged success. `assertRolesLanded` is what makes that loud.
//
// WHAT IT DOES NOT DO: it never repoints a role at a different account and it
// never deactivates one. Both are the org's decisions, and both are reversible
// only by a human who knows why.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../postings/default-chart'
import { seedSession, UnifiedCrudHandler } from '../resources/crud'
import { SystemUserService } from '../users/system-user-service'

const logger = createScopedLogger('seed:gl-account-chart')

/** What one pass over one org did. */
export interface ChartSeedResult {
  /** Accounts inserted by this pass. */
  created: number
  /** Codes the org already held, left exactly as they were. */
  skipped: number
}

/**
 * Seed the default chart of accounts into one organization.
 *
 * Idempotent: a second pass over the same org creates nothing and reports
 * `created: 0`, which is what lets migration 108 keep reporting
 * `alreadyUpToDate` (and therefore skip its org-cache flush) on a re-run.
 *
 * @param glAccountDefId the org's `gl_account` EntityDefinition, or undefined
 * when it has none — in which case this is a no-op rather than an error, the
 * same tolerance every other step of 108 has for a def that is not there yet.
 */
export async function seedDefaultChartOfAccounts(
  db: Database,
  organizationId: string,
  glAccountDefId: string | undefined
): Promise<ChartSeedResult> {
  if (!glAccountDefId) return { created: 0, skipped: 0 }

  // The `code` field has to exist before its values can be read or written. On
  // the very first pass `ensureCustomFields` has just created it; on an org
  // that somehow lacks it, seeding would write rows with no identity at all.
  const fields = await db
    .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, glAccountDefId))

  const codeFieldId = fields.find((f) => f.systemAttribute === 'gl_account_code')?.id
  if (!codeFieldId) return { created: 0, skipped: 0 }

  // Every code the org already holds, ARCHIVED ROWS INCLUDED.
  //
  // 🛑 Deliberate, and the opposite of what the unique gate does. The gate
  // ignores archived rows, so re-seeding `1310` over an archived `1310` would
  // pass validation and leave two — and un-archiving the old one later is a
  // click. Someone who archived an account did not ask for it back.
  const existing = await db
    .select({ code: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeFieldId)
      )
    )

  const held = new Set(existing.map((row) => row.code).filter((c): c is string => !!c))

  const missing = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => !held.has(account.code))
  if (missing.length === 0) {
    return { created: 0, skipped: DEFAULT_CHART_OF_ACCOUNTS.length }
  }

  const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

  // The seed session's silent lane suppresses events — there is nobody to
  // notify while an org is being migrated, and 28 accounts x 28 orgs of
  // invalidations is real time on a cold Redis.
  const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
    session: seedSession('gl account chart seeding'),
  })

  let created = 0
  const expectedRoles = new Map<string, string>()
  // Sequential on purpose — see rule 2. `code` and `role` are both guarded by a
  // check-then-write uniqueness gate, which two concurrent creates would both
  // pass.
  for (const account of missing) {
    const result = await handler.create(glAccountDefId, {
      gl_account_code: account.code,
      gl_account_name: account.name,
      gl_account_type: account.accountType,
      // Omitted, never null — see rule 4.
      ...(account.role ? { gl_account_role: account.role } : {}),
      gl_account_is_active: true,
    })
    if (account.role) expectedRoles.set(result.instance.id, account.role)
    created++
  }

  await assertRolesLanded(db, fields, expectedRoles)

  logger.info('Seeded default chart of accounts', {
    organizationId,
    created,
    skipped: DEFAULT_CHART_OF_ACCOUNTS.length - created,
  })

  return { created, skipped: DEFAULT_CHART_OF_ACCOUNTS.length - created }
}

/**
 * Rule 5, and the one this file exists to make impossible to get wrong twice.
 *
 * 🛑 **`UnifiedCrudHandler` silently DROPS a value whose field it cannot
 * resolve.** It resolves an entity's fields from the org cache, so a
 * `gl_account_role` created moments earlier in the same migration pass is
 * invisible to it until that cache is dropped — and the create succeeds, writes
 * every other field, and reports success. That is exactly what happened on the
 * first run of this seed: 784 accounts across 28 orgs, every column populated
 * except the one the whole role indirection depends on, no error, and a
 * migration log line reading "applied".
 *
 * The caller's job is to flush before seeding (108 does, and says why). This is
 * the check that makes a failure to do so LOUD instead of a chart that looks
 * complete and resolves nothing.
 *
 * Scoped to accounts THIS pass created, deliberately. An account the org
 * already had with no role is the bookkeeper's business; an account we just
 * wrote a role onto that has no role is a bug, without ambiguity.
 *
 * @throws {Error} listing the accounts whose role did not land.
 */
async function assertRolesLanded(
  db: Database,
  fields: { id: string; systemAttribute: string | null }[],
  expectedRoles: Map<string, string>
): Promise<void> {
  if (expectedRoles.size === 0) return

  const roleFieldId = fields.find((f) => f.systemAttribute === 'gl_account_role')?.id
  if (!roleFieldId) {
    throw new Error(
      'gl_account_role is not materialised, but the seeded chart declares roles — ' +
        'the chart would resolve nothing. Run the field migration before seeding.'
    )
  }

  const written = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, roleFieldId),
        inArray(schema.FieldValue.entityId, [...expectedRoles.keys()])
      )
    )

  const landed = new Set(written.map((row) => row.entityId))
  const dropped = [...expectedRoles.entries()]
    .filter(([instanceId]) => !landed.has(instanceId))
    .map(([, role]) => role)

  if (dropped.length > 0) {
    throw new Error(
      `Seeded ${expectedRoles.size} gl_account roles but ${dropped.length} did not land ` +
        `(${dropped.join(', ')}). The org cache is almost certainly stale — flush ` +
        '`customFields` and `resources` BEFORE seeding the chart.'
    )
  }
}
