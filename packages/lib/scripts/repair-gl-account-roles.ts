// packages/lib/scripts/repair-gl-account-roles.ts
//
// One-time repair for the charts of accounts seeded by the FIRST run of
// migration 108's `seedDefaultChartOfAccounts`.
//
// WHAT WENT WRONG
//
// `UnifiedCrudHandler` resolves an entity's fields from the ORG CACHE, and it
// DROPS a value whose field it cannot resolve rather than failing. 108 created
// `gl_account_role` and then seeded the chart in the same pass, with the cache
// flush at the END of `up()` - so every create ran against a `customFields`
// snapshot taken before the role field existed. 784 accounts across 28 orgs were
// written with code, name, type and isActive, and NO role. Nothing errored and
// the migration logged "applied".
//
// 108 now flushes before it seeds, and `assertRolesLanded` throws if a role it
// wrote is not there afterwards - so this cannot recur. This script exists only
// to fix the rows that already landed, because the seed is idempotent on `code`
// and will therefore never revisit them.
//
// WHY IT REPAIRS RATHER THAN DELETES AND RE-SEEDS
//
// Deleting 784 `EntityInstance` rows to re-create them identically is a
// destructive answer to a missing field value. This sets the one value that is
// missing, on the account that already holds the matching code, and only when
// that account has NO role at all - it never overwrites a role somebody chose.
//
//   npx dotenv -- npx tsx packages/lib/scripts/repair-gl-account-roles.ts

import { database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../src/cache'
import { DEFAULT_CHART_OF_ACCOUNTS } from '../src/postings/default-chart'
import { seedSession, UnifiedCrudHandler } from '../src/resources/crud'
import { toRecordId } from '../src/resources/resource-id'
import { SystemUserService } from '../src/users/system-user-service'

async function repairOrg(organizationId: string): Promise<number> {
  const [def] = await database
    .select({ id: schema.EntityDefinition.id })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.organizationId, organizationId),
        eq(schema.EntityDefinition.entityType, 'gl_account')
      )
    )
  if (!def) return 0

  // 🛑 First, and this is the entire point of the exercise: the handler below
  // reads its field list from here.
  await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])

  const fields = await database
    .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
    .from(schema.CustomField)
    .where(eq(schema.CustomField.entityDefinitionId, def.id))

  const codeFieldId = fields.find((f) => f.systemAttribute === 'gl_account_code')?.id
  const roleFieldId = fields.find((f) => f.systemAttribute === 'gl_account_role')?.id
  if (!codeFieldId || !roleFieldId) return 0

  const instances = await database
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.entityDefinitionId, def.id),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (instances.length === 0) return 0
  const instanceIds = instances.map((i) => i.id)

  const codeRows = await database
    .select({ entityId: schema.FieldValue.entityId, valueText: schema.FieldValue.valueText })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, codeFieldId),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )
  const roleRows = await database
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, roleFieldId),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )

  const instanceByCode = new Map<string, string>()
  for (const row of codeRows) {
    if (row.valueText && !instanceByCode.has(row.valueText)) {
      instanceByCode.set(row.valueText, row.entityId)
    }
  }
  const alreadyRoled = new Set(roleRows.map((r) => r.entityId))

  const handler = new UnifiedCrudHandler(
    organizationId,
    await systemUser(organizationId),
    database,
    undefined,
    {
      session: seedSession('gl account role repair'),
    }
  )

  let repaired = 0
  for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
    if (!account.role) continue
    const instanceId = instanceByCode.get(account.code)
    // Never mint an account here. If the code is absent the chart seed will
    // create it on its next pass, with the role, through the fixed path.
    if (!instanceId) continue
    // Never overwrite. A role somebody set - or moved to another account - is
    // theirs, and this script has no way to know which.
    if (alreadyRoled.has(instanceId)) continue

    await handler.update(toRecordId(def.id, instanceId), { gl_account_role: account.role })
    repaired++
  }

  // Verify, rather than trust the absence of an exception - that is the exact
  // mistake being repaired.
  const after = await database
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.fieldId, roleFieldId),
        inArray(schema.FieldValue.entityId, instanceIds)
      )
    )
  const expected = DEFAULT_CHART_OF_ACCOUNTS.filter(
    (a) => a.role && instanceByCode.has(a.code)
  ).length
  if (after.length !== expected) {
    throw new Error(
      `${organizationId}: expected ${expected} roled accounts, found ${after.length} after repair`
    )
  }

  return repaired
}

const systemUserCache = new Map<string, string>()
async function systemUser(organizationId: string): Promise<string> {
  const cached = systemUserCache.get(organizationId)
  if (cached) return cached
  const id = await SystemUserService.getSystemUserForActions(organizationId)
  systemUserCache.set(organizationId, id)
  return id
}

async function main() {
  const orgs = await database.select({ id: schema.Organization.id }).from(schema.Organization)
  let total = 0
  let touched = 0
  for (const org of orgs) {
    const repaired = await repairOrg(org.id)
    total += repaired
    if (repaired > 0) touched++
  }
  console.log(
    `repair-gl-account-roles: ${total} roles set across ${touched} of ${orgs.length} orgs`
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
