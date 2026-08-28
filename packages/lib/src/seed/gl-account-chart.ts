// packages/lib/src/seed/gl-account-chart.ts
//
// Seeds `DEFAULT_CHART_OF_ACCOUNTS` into one organization as `gl_account`
// EntityInstances, and points each posting ROLE at the account that fulfils it
// via a `GlRoleAssignment` row (decision `G19`).
//
// WHY THE CHART LIVES IN `lib/postings/` AND THE WRITER LIVES HERE
//
// `postings/default-chart.ts` is pure data — no database, no io — because
// `postings/` already owns the account vocabulary (`ACCOUNT_ROLES`) that the
// chart's `role` column maps onto. `seed -> lib` is the sanctioned dependency
// direction and `lib -> seed` is forbidden, so the writer imports the constant
// and never the reverse.
//
// ✅ THE HAZARD THIS FILE USED TO CARRY IS GONE
//
// Rule 5 used to be `assertRolesLanded`, and it existed because roles were
// written as a `gl_account_role` FIELD through `UnifiedCrudHandler` — which
// resolves fields from the ORG CACHE and SILENTLY DROPS a value whose field it
// cannot resolve. A field created moments earlier in the same migration pass is
// invisible to it, so the first run of this seed wrote 784 accounts across 28
// orgs with every column populated except the one the whole role indirection
// depends on, and logged success.
//
// `G19` moved the mapping to the `GlRoleAssignment` TABLE, and the assignment
// insert below is a plain Drizzle write: no field resolution, no org cache, no
// handler, nothing to drop. The failure mode is structurally unavailable now
// rather than merely guarded against — which is a real, and easy to miss,
// secondary win of the table route.
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
//     type. A chart is a bookkeeper's document (decision `G7`) — they renumber,
//     rename and deactivate, and re-running the seed must be a no-op over their
//     edits.
//  4. **Never repoint a role the org has already mapped.** The assignment
//     insert is `ON CONFLICT (organizationId, role) DO NOTHING`, so a
//     bookkeeper who moved `grni` onto their own `2155` keeps it through every
//     re-seed. Assignments are written for role-carrying accounts whether this
//     pass created them or found them, which is what makes the seed
//     self-healing after the wipe-and-reseed of entity migration 115.
//
// WHAT IT DOES NOT DO: it never repoints a role at a different account and it
// never deactivates one. Both are the org's decisions, and both are reversible
// only by a human who knows why.

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
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
  /** `GlRoleAssignment` rows inserted by this pass. Zero on a settled org. */
  rolesAssigned: number
}

/**
 * Seed the default chart of accounts, and its role assignments, into one org.
 *
 * Idempotent: a second pass over the same org creates nothing and reports
 * `created: 0, rolesAssigned: 0`, which is what lets migration 108 keep
 * reporting `alreadyUpToDate` (and therefore skip its org-cache flush) on a
 * re-run.
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
  const empty: ChartSeedResult = { created: 0, skipped: 0, rolesAssigned: 0 }
  if (!glAccountDefId) return empty

  // The `code` field has to exist before its values can be read or written. On
  // the very first pass `ensureCustomFields` has just created it; on an org
  // that somehow lacks it, seeding would write rows with no identity at all.
  const [codeField] = await db
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.entityDefinitionId, glAccountDefId),
        eq(schema.CustomField.systemAttribute, 'gl_account_code')
      )
    )
    .limit(1)

  if (!codeField) return empty

  // Every code the org already holds, ARCHIVED ROWS INCLUDED, with the instance
  // that carries it.
  //
  // 🛑 Deliberate, and the opposite of what the unique gate does. The gate
  // ignores archived rows, so re-seeding `1310` over an archived `1310` would
  // pass validation and leave two — and un-archiving the old one later is a
  // click. Someone who archived an account did not ask for it back.
  const existing = await db
    .select({ code: schema.FieldValue.valueText, entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, codeField.id)
      )
    )

  /** code -> the instance that holds it. Grows as this pass creates accounts. */
  const byCode = new Map<string, string>()
  for (const row of existing) {
    if (row.code) byCode.set(row.code, row.entityId)
  }

  const missing = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => !byCode.has(account.code))

  let created = 0
  if (missing.length > 0) {
    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)

    // The seed session's silent lane suppresses events — there is nobody to
    // notify while an org is being migrated, and 29 accounts x 28 orgs of
    // invalidations is real time on a cold Redis.
    const handler = new UnifiedCrudHandler(organizationId, systemUserId, db, undefined, {
      session: seedSession('gl account chart seeding'),
    })

    // Sequential on purpose — see rule 2. `code` is guarded by a
    // check-then-write uniqueness gate, which two concurrent creates would both
    // pass.
    for (const account of missing) {
      const result = await handler.create(glAccountDefId, {
        gl_account_code: account.code,
        gl_account_name: account.name,
        gl_account_type: account.accountType,
        gl_account_is_active: true,
      })
      byCode.set(account.code, result.instance.id)
      created++
    }
  }

  const rolesAssigned = await assignSeededRoles(db, organizationId, byCode)

  if (created > 0 || rolesAssigned > 0) {
    logger.info('Seeded default chart of accounts', {
      organizationId,
      created,
      skipped: DEFAULT_CHART_OF_ACCOUNTS.length - created,
      rolesAssigned,
    })
  }

  return { created, skipped: DEFAULT_CHART_OF_ACCOUNTS.length - created, rolesAssigned }
}

/**
 * Point every role the default chart declares at the account that carries its
 * code, without ever overwriting a mapping the org already made.
 *
 * `ON CONFLICT (organizationId, role) DO NOTHING` is rule 4 in one line: the
 * unique index that makes the resolver's answer unambiguous is the same index
 * that makes this insert safe to repeat. A bookkeeper who repointed `grni` at
 * their own `2155` keeps it through every re-seed, every migration re-run and
 * every fresh-org pass.
 *
 * `source: 'seed'` and NOT `confirmedAt`. `G19` leans on that difference: the
 * setup wizard has to render "we chose this for you" differently from "you
 * chose this", and stamping a confirmation nobody gave would erase the
 * distinction on day one for every org.
 *
 * A role whose account is missing from `byCode` is skipped rather than written
 * as a dangling id — that can only happen if the chart constant and this org's
 * chart disagree, and a mapping pointing at nothing would fail the resolver
 * with a message about an archived account rather than about a broken seed.
 */
async function assignSeededRoles(
  db: Database,
  organizationId: string,
  byCode: Map<string, string>
): Promise<number> {
  const rows = DEFAULT_CHART_OF_ACCOUNTS.flatMap((account) => {
    if (!account.role) return []
    const glAccountId = byCode.get(account.code)
    if (!glAccountId) return []
    return [{ organizationId, role: account.role, glAccountId, source: 'seed' }]
  })

  if (rows.length === 0) return 0

  const inserted = await db
    .insert(schema.GlRoleAssignment)
    .values(rows)
    .onConflictDoNothing({
      target: [schema.GlRoleAssignment.organizationId, schema.GlRoleAssignment.role],
    })
    .returning({ id: schema.GlRoleAssignment.id })

  return inserted.length
}
