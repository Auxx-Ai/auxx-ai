// packages/lib/scripts/reset-gl-chart.ts
//
// 🛑 DEV-ONLY. Deletes every organization's chart of accounts and rebuilds it
// from `DEFAULT_CHART_OF_ACCOUNTS`, with `GlRoleAssignment` rows in place of the
// retired `gl_account_role` field (decision `G19`).
//
//   npx dotenv -- npx tsx packages/lib/scripts/reset-gl-chart.ts
//
// ── Why this is a script and NOT an entity migration ────────────────────────
//
// `gl_account` has never existed anywhere but this machine. Entity migration
// 108, which creates the def and seeds the chart, has only ever run against
// local dev — it is `applied` in the local `DataMigration` ledger and nowhere
// else, and there is no deployed environment, no teammate checkout and no
// persistent CI database holding the old shape (confirmed 2026-08-28).
//
// The house rule for exactly that situation: **a migration that is `applied` in
// the LOCAL dev ledger is not frozen.** The "a change needs a new migration id"
// rule protects migrations that have run somewhere other than this machine. So
// 108 was edited in place to emit the final shape directly — no `role` field, 29
// accounts, `2150` broadened, `5095` added, `GlRoleAssignment` rows written by
// `seedDefaultChartOfAccounts` — and a fresh database gets all of it from 108
// alone, with no follow-up migration in existence. Minting a new id would have
// produced two migrations where one does, and an id is permanent.
//
// This script is the door for the ONE database that already ran the old 108.
// It consumes no migration id and ships nothing. **Production needs no
// equivalent, because production has never had the old shape.**
//
// ── Why a WIPE rather than a migration in place ─────────────────────────────
//
// Nothing in the general-ledger track ships until the whole engine is done, so
// there is no release in which anyone observes an intermediate shape. That fact
// deletes a rename migration for `2150`, an options migration for
// `gl_account_role`, and a backfill of the field into the table — every one of
// which existed only to carry one shape forward into another. Wipe and re-seed
// from the corrected constant instead.
//
// Verified before this was written (2026-08-28):
//
//   - 784 `gl_account` rows, 28 accounts x 28 orgs.
//   - 0 `FieldValue` rows pointing AT a `gl_account` instance.
//   - 0 `RecordIdentity` rows on a `gl_account` instance — no provider's own
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
// ── Safe to re-run ──────────────────────────────────────────────────────────
//
// The second pass finds no `gl_account_role` field, deletes and re-seeds the
// same 29 accounts, and re-writes the same 13 assignments. Idempotent in effect.
// `seedDefaultChartOfAccounts` is `ON CONFLICT (organizationId, role) DO
// NOTHING`, so a mapping somebody repointed by hand survives — but on this
// script's path the assignments are cleared first, because the accounts they
// point at are about to stop existing.

import { database, schema } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { seedDefaultChartOfAccounts } from '../src/seed/gl-account-chart'

const RETIRED_ROLE_ATTRIBUTE = 'gl_account_role'

interface OrgResult {
  organizationId: string
  accountsRemoved: number
  accountsSeeded: number
  rolesAssigned: number
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

    const identities = await database
      .select({ id: schema.RecordIdentity.id })
      .from(schema.RecordIdentity)
      .where(inArray(schema.RecordIdentity.entityInstanceId, accountIds))
      .limit(5)

    if (identities.length > 0) {
      throw new Error(
        `Organization ${organizationId} has ${identities.length}+ RecordIdentity row(s) on a gl_account instance; refusing to wipe the chart. Those carry a connected provider's own account id (decision P2) and cascade away with the instance — wiping them is unrecoverable. Re-import the chart from the provider instead.`
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
  // explicitly and FIRST — bottom-up, the order entity migration 114 uses. An
  // orphaned value row would otherwise outlive its instance and become
  // unreachable rather than merely wrong.
  if (accountIds.length > 0) {
    await database.delete(schema.FieldValue).where(inArray(schema.FieldValue.entityId, accountIds))
    await database
      .delete(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, accountIds))
  }

  // Any assignment written by an earlier pass points at an instance id that no
  // longer exists. Clear them so the re-seed writes a live mapping rather than
  // being swallowed by `ON CONFLICT (organizationId, role) DO NOTHING` against a
  // dead one.
  await database
    .delete(schema.GlRoleAssignment)
    .where(eq(schema.GlRoleAssignment.organizationId, organizationId))

  // ── 3. The org cache, dropped BEFORE anything writes a record ────────────
  //
  // 🛑 Position, not tidying — the lesson migration 108 paid for.
  // `UnifiedCrudHandler` resolves an entity's fields from the ORG CACHE and
  // silently DROPS a value whose field it cannot resolve. The seed below writes
  // through that handler, and the cache still holds the `gl_account_role` field
  // this pass just deleted.
  await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])

  // ── 4. Re-seed the corrected chart, and its role assignments ─────────────
  const chart = await seedDefaultChartOfAccounts(database, organizationId, def.id)

  return {
    organizationId,
    accountsRemoved: accountIds.length,
    accountsSeeded: chart.created,
    rolesAssigned: chart.rolesAssigned,
    roleFieldsRemoved: roleFieldIds.length,
  }
}

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)

  let touched = 0
  let accountsSeeded = 0
  let rolesAssigned = 0
  let roleFieldsRemoved = 0

  for (const org of orgs) {
    const result = await resetOrg(org.id)
    if (!result) continue
    touched++
    accountsSeeded += result.accountsSeeded
    rolesAssigned += result.rolesAssigned
    roleFieldsRemoved += result.roleFieldsRemoved
  }

  console.log(
    `reset-gl-chart: ${touched} of ${orgs.length} orgs have a gl_account def; ` +
      `seeded ${accountsSeeded} accounts, wrote ${rolesAssigned} role assignments, ` +
      `removed ${roleFieldsRemoved} gl_account_role field(s)`
  )
  console.log(
    "Verify in Postgres — this script's own counts are not the witness:\n" +
      '  SELECT count(*) FROM "CustomField" WHERE "systemAttribute" = \'gl_account_role\';  -- 0\n' +
      '  SELECT count(*) FROM "GlRoleAssignment";                                          -- 13 per org'
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
