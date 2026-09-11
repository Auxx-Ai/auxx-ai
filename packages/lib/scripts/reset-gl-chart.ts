// packages/lib/scripts/reset-gl-chart.ts
//
// 🛑 DEV-ONLY. Deletes every organization's chart of accounts, its
// `GlRoleAssignment` rows and the retired `gl_account_role` field, if it is
// still there. Does NOT re-seed: accounting is opt-in now
// (plans/accounting/tasks/17-accounting-is-opt-in.md §1, §2), and this script
// is the dev-side twin of entity migration 142
// (`data-migrations/migrations/142-wipe-seeded-charts.ts`), which does
// the same wipe (plus journal entries, the QuickBooks account map and the
// wizard's setup settings) against every other database. **Provision chart in
// the setup wizard is the way back onto a chart**, the same door a fresh org
// has always used.
//
//   npx dotenv -- npx tsx packages/lib/scripts/reset-gl-chart.ts
//
// ── Why this is a script and NOT the entity migration itself ────────────────
//
// `gl_account` has never existed anywhere but this machine in the exact shape
// this script corrects (no `role` field, the pre-packs 37-account flat chart,
// `2150` broadened, `5095` added); entity migration 108, which created the def
// in that shape, has only
// ever run against local dev and is `applied` in the local `DataMigration`
// ledger and nowhere else (confirmed 2026-08-28). Migration 142 wipes the
// chart everywhere, including here; this script exists for the same reason it
// always has: a door to re-run the wipe locally by hand, without touching the
// `DataMigration` ledger, and now wipes without the re-seed step 142 also
// omits.
//
// Verified before this was written (2026-08-28):
//
//   - 784 `gl_account` rows, 28 accounts x 28 orgs.
//   - 0 `FieldValue` rows pointing AT a `gl_account` instance.
//     ⚠️ That survey, and the guard below, originally looked at
//     `relatedEntityId` ALONE - the relationship column. Task 15's pointers are
//     plain TEXT (`bank_account.glAccount`, `payment_gateway.clearingAccount`
//     and six more), so they live in `valueText` and were invisible to both.
//     On 2026-09-11 this script wiped a chart that a `payment_gateway` was
//     pointing at, reported success, and left a REQUIRED field naming an id
//     that existed nowhere; the next fulfillment post refused. The guard now
//     asks `findGlAccountPointers`, which checks both columns.
//   - 0 `RecordIdentity` rows on a `gl_account` instance - no provider's own
//     account id is lost.
//   - 0 `GlPosting` / `GlPostingLine` rows.
//   - No human edits: the 336 rows with `updatedAt > createdAt` were all touched
//     inside one four-second window by a since-deleted repair script.
//
// Both survey facts are RE-CHECKED per organization below rather than trusted,
// and the script fails closed and loudly on either. A `RecordIdentity` on a
// chart row would be a connected provider's account mapping, and wiping that is
// unrecoverable.
//
// ── Safe to re-run ───────────────────────────────────────────────────────────
//
// The second pass finds no `gl_account_role` field and no chart rows left to
// delete. Idempotent in effect.

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { findGlAccountPointers } from '../src/postings/gl-account-pointers'

const RETIRED_ROLE_ATTRIBUTE = 'gl_account_role'

interface OrgResult {
  organizationId: string
  accountsRemoved: number
  roleAssignmentsRemoved: number
  roleFieldsRemoved: number
}

async function resetOrg(organizationId: string): Promise<OrgResult | null> {
  const [def] = await database
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'gl_account')
      )
    )
    .limit(1)

  if (!def) return null

  const roleFields = await database
    .select({ id: schema.CustomField.id })
    .from(schema.CustomField)
    .where(
      and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.entityDefinitionId, def.id),
        eq(schema.CustomField.systemAttribute, RETIRED_ROLE_ATTRIBUTE)
      )
    )

  const accounts = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, def.id)
      )
    )

  const accountIds = accounts.map((row) => row.id)

  // ── The guards. Fail CLOSED on anything that points AT the chart. ────────
  if (accountIds.length > 0) {
    const referencing = await database
      .select({ id: schema.FieldValue.id, fieldId: schema.FieldValue.fieldId })
      .from(schema.FieldValue)
      .where(inArray(schema.FieldValue.relatedEntityId, accountIds))
      .limit(5)

    if (referencing.length > 0) {
      throw new Error(
        `Organization ${organizationId} has ${referencing.length}+ FieldValue row(s) pointing at a gl_account instance; refusing to wipe the chart. It was expected to be unreferenced (verified 2026-08-28). Repoint or clear these values first. Fields: ${referencing
          .map((r) => r.fieldId)
          .join(', ')}`
      )
    }

    // 🛑 The same question asked of the TEXT pointers, which the query above
    // cannot see. See the header note: this is the half that was missing.
    const textPointers = await findGlAccountPointers(database, organizationId, accountIds)
    if (textPointers.length > 0) {
      throw new Error(
        `Organization ${organizationId} has ${textPointers.length}+ record(s) holding a gl_account id in a TEXT field; refusing to wipe the chart. These carry no foreign key, so wiping leaves them naming an account that does not exist and the next posting that needs one refuses. Repoint them first: ${textPointers
          .map((pointer) => `${pointer.attribute} on ${pointer.entityId}`)
          .join(', ')}`
      )
    }

    const identities = await database
      .select({ id: schema.RecordIdentity.id })
      .from(schema.RecordIdentity)
      .where(inArray(schema.RecordIdentity.entityInstanceId, accountIds))
      .limit(5)

    if (identities.length > 0) {
      throw new Error(
        `Organization ${organizationId} has ${identities.length}+ RecordIdentity row(s) on a gl_account instance; refusing to wipe the chart. Those carry a connected provider's own account id (decision P2) and cascade away with the instance - wiping them is unrecoverable. Re-import the chart from the provider instead.`
      )
    }
  }

  // ── 1. The retired field, and every value written through it ─────────────
  const roleFieldIds = roleFields.map((f) => f.id)
  if (roleFieldIds.length > 0) {
    await database.delete(schema.FieldValue).where(inArray(schema.FieldValue.fieldId, roleFieldIds))
    await database.delete(schema.CustomField).where(inArray(schema.CustomField.id, roleFieldIds))
  }

  // ── 2. The chart itself ──────────────────────────────────────────────────
  //
  // `FieldValue` has no foreign key to `EntityInstance`, so its rows are deleted
  // explicitly and FIRST - bottom-up, the order entity migration 114 uses. An
  // orphaned value row would otherwise outlive its instance and become
  // unreachable rather than merely wrong.
  if (accountIds.length > 0) {
    await database.delete(schema.FieldValue).where(inArray(schema.FieldValue.entityId, accountIds))
    await database
      .delete(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, accountIds))
  }

  // Any assignment points at an instance id that no longer exists once the
  // chart above is gone, so it goes too: the account it names cannot be
  // re-mapped by a bookkeeper who can no longer see it.
  const roleAssignments = await database
    .select({ id: schema.GlRoleAssignment.id })
    .from(schema.GlRoleAssignment)
    .where(eq(schema.GlRoleAssignment.organizationId, organizationId))
  await database
    .delete(schema.GlRoleAssignment)
    .where(eq(schema.GlRoleAssignment.organizationId, organizationId))

  // ── 3. The org cache ──────────────────────────────────────────────────────
  //
  // `UnifiedCrudHandler` resolves an entity's fields from the ORG CACHE, so a
  // stale `customFields` / `resources` entry would keep serving the chart this
  // pass just deleted. No re-seed follows this flush anymore (17 §1, §2):
  // Provision chart in the setup wizard is the only door back onto a chart.
  await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])

  return {
    organizationId,
    accountsRemoved: accountIds.length,
    roleAssignmentsRemoved: roleAssignments.length,
    roleFieldsRemoved: roleFieldIds.length,
  }
}

/**
 * Optional organization filter (id or name). Without it this stays what it has
 * always been: every org in the database. With it, one org - because a dev
 * machine now holds charts belonging to more than one demo org, and wiping a
 * neighbour's to reset your own is a surprise, not a reset.
 */
const ORG_ARG = process.argv.slice(2).find((a) => !a.startsWith('--'))

async function selectOrgs(): Promise<{ id: string }[]> {
  if (!ORG_ARG) {
    return database.select({ id: schema.Organization.id }).from(schema.Organization)
  }
  const [byId] = await database
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .where(eq(schema.Organization.id, ORG_ARG))
    .limit(1)
  if (byId) return [byId]

  const [byName] = await database
    .select({ id: schema.Organization.id })
    .from(schema.Organization)
    .where(eq(schema.Organization.name, ORG_ARG))
    .limit(1)
  if (byName) return [byName]

  console.error(`no organization matched "${ORG_ARG}"`)
  process.exit(1)
}

async function main() {
  const orgs = await selectOrgs()
  console.log(ORG_ARG ? `scope: ${ORG_ARG}` : 'scope: EVERY organization')

  let touched = 0
  let accountsRemoved = 0
  let roleAssignmentsRemoved = 0
  let roleFieldsRemoved = 0

  for (const org of orgs) {
    const result = await resetOrg(org.id)
    if (!result) continue
    touched++
    accountsRemoved += result.accountsRemoved
    roleAssignmentsRemoved += result.roleAssignmentsRemoved
    roleFieldsRemoved += result.roleFieldsRemoved
  }

  console.log(
    `reset-gl-chart: ${touched} of ${orgs.length} orgs have a gl_account def; ` +
      `removed ${accountsRemoved} account(s), ${roleAssignmentsRemoved} role assignment(s), ` +
      `${roleFieldsRemoved} gl_account_role field(s). No re-seed; Provision chart in the ` +
      'setup wizard is the way back.'
  )
  console.log(
    "Verify in Postgres - this script's own counts are not the witness:\n" +
      '  SELECT count(*) FROM "CustomField" WHERE "systemAttribute" = \'gl_account_role\';  -- 0\n' +
      '  SELECT count(*) FROM "GlRoleAssignment";                                          -- 0 per org'
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
