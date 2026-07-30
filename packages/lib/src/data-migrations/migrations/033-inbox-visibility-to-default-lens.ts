// packages/lib/src/data-migrations/migrations/033-inbox-visibility-to-default-lens.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-033')

/**
 * Convert the legacy `inbox_visibility` setting into the `inbox_default_lens`
 * visibility floor (mail-permissions §2.2):
 *
 * - `org_members` (or unset — it was the default) → `full`
 * - `private` / `custom` → `none`
 *
 * Also deletes the `role/org_member` ResourceAccess rows on inboxes — they
 * were how `org_members` visibility was encoded; the default-lens field IS the
 * floor now. Readers switched to the cached `userInstanceGrants` context in
 * the same PR (Phase 1.6), so removing the rows is behavior-neutral.
 *
 * Requires entity migration `025-inbox-default-lens` (sorts before this id) to
 * have created the CustomField. Idempotent: only inserts missing FieldValues;
 * the role-row delete is a no-op on re-run.
 */
export const migration033InboxVisibilityToDefaultLens: DataMigrationDef = {
  id: '033-inbox-visibility-to-default-lens',
  description: 'Convert inbox_visibility to inbox_default_lens and drop org_member role rows',
  async run(db: Database): Promise<void> {
    const inboxDefs = await db
      .select({
        id: schema.EntityDefinition.id,
        organizationId: schema.EntityDefinition.organizationId,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.entityType, 'inbox'))

    const defIds = inboxDefs.map((d) => d.id)
    const orgByDefId = new Map(inboxDefs.map((d) => [d.id, d.organizationId]))

    if (defIds.length === 0) {
      logger.info('No inbox entity definitions found')
      return
    }

    const fields = await db
      .select({
        id: schema.CustomField.id,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
        systemAttribute: schema.CustomField.systemAttribute,
      })
      .from(schema.CustomField)
      .where(
        and(
          inArray(schema.CustomField.entityDefinitionId, defIds),
          inArray(schema.CustomField.systemAttribute, ['inbox_visibility', 'inbox_default_lens'])
        )
      )

    const visibilityFieldByDef = new Map<string, string>()
    const lensFieldByDef = new Map<string, string>()
    for (const f of fields) {
      if (!f.entityDefinitionId) continue
      if (f.systemAttribute === 'inbox_visibility')
        visibilityFieldByDef.set(f.entityDefinitionId, f.id)
      if (f.systemAttribute === 'inbox_default_lens') lensFieldByDef.set(f.entityDefinitionId, f.id)
    }

    const missingLensField = defIds.filter((id) => !lensFieldByDef.has(id))
    if (missingLensField.length > 0) {
      // 025 sorts before this migration and fail-stop enforces the order, so
      // this indicates a partially-failed 025 run — stop rather than skip orgs.
      throw new Error(
        `inbox_default_lens CustomField missing for ${missingLensField.length} inbox def(s); run entity migration 025 first`
      )
    }

    const instances = await db
      .select({
        id: schema.EntityInstance.id,
        entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.entityDefinitionId, defIds))

    const instanceIds = instances.map((i) => i.id)
    const allFieldIds = [...visibilityFieldByDef.values(), ...lensFieldByDef.values()]

    const values = instanceIds.length
      ? await db
          .select({
            entityId: schema.FieldValue.entityId,
            fieldId: schema.FieldValue.fieldId,
            optionId: schema.FieldValue.optionId,
          })
          .from(schema.FieldValue)
          .where(
            and(
              inArray(schema.FieldValue.entityId, instanceIds),
              inArray(schema.FieldValue.fieldId, allFieldIds)
            )
          )
      : []

    const visibilityByInstance = new Map<string, string | null>()
    const hasLensValue = new Set<string>()
    const lensFieldIds = new Set(lensFieldByDef.values())
    for (const v of values) {
      if (lensFieldIds.has(v.fieldId)) hasLensValue.add(v.entityId)
      else visibilityByInstance.set(v.entityId, v.optionId)
    }

    const now = new Date()
    const inserts = instances
      .filter((i) => !hasLensValue.has(i.id))
      .map((i) => {
        const visibility = visibilityByInstance.get(i.id) ?? 'org_members'
        const organizationId = orgByDefId.get(i.entityDefinitionId!)!
        return {
          organizationId,
          fieldId: lensFieldByDef.get(i.entityDefinitionId!)!,
          entityId: i.id,
          entityDefinitionId: i.entityDefinitionId!,
          optionId: visibility === 'org_members' ? 'full' : 'none',
          updatedAt: now,
        }
      })

    if (inserts.length > 0) {
      await db.insert(schema.FieldValue).values(inserts)
    }

    // Drop the role rows that encoded org_members visibility (instance and
    // type level — the floor field replaces both).
    const deleted = await db
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.entityDefinitionId, 'inbox'),
          eq(schema.ResourceAccess.granteeType, 'role'),
          eq(schema.ResourceAccess.granteeId, 'org_member')
        )
      )
      .returning({ organizationId: schema.ResourceAccess.organizationId })

    // The cached `inboxes` shape now carries defaultLens — recompute for every
    // org whose data changed so readers pick up the converted floors.
    const affectedOrgs = new Set<string>([
      ...inserts.map((i) => i.organizationId),
      ...deleted.map((d) => d.organizationId),
    ])
    for (const orgId of affectedOrgs) {
      await getOrgCache().invalidateAndRecompute(orgId, ['inboxes'])
    }

    logger.info('Converted inbox_visibility to inbox_default_lens', {
      inboxes: instances.length,
      lensValuesInserted: inserts.length,
      roleRowsDeleted: deleted.length,
      orgsInvalidated: affectedOrgs.size,
    })
  },
}
