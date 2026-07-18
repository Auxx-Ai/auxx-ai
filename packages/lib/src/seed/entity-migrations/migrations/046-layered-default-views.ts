// packages/lib/src/seed/entity-migrations/migrations/046-layered-default-views.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { FieldViewConfig } from '../../../conditions/field-view-config'
import { RESOURCE_FIELD_REGISTRY } from '../../../resources/registry/field-registry'
import type { ResourceField } from '../../../resources/registry/field-types'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:046')

/**
 * Migration 046: Kill the default-view migration treadmill (plans/view-config).
 *
 * Panel + table default visibility/order is now computed live from the registry
 * (`showInPanel` / `showInTable` / `systemSortOrder`), and `createFieldViews` no
 * longer seeds `contextType:'panel'`/`'table'` rows. This one-time migration
 * reconciles orgs seeded under the old scheme so removing those rows preserves
 * behavior:
 *
 * 1. DELETE the dead `contextType:'table'` default rows. They were keyed by the
 *    bare `entityDefinitionId` while the table reads `entity-${entityDefinitionId}`
 *    (a key mismatch, plan §2.2), so they were never read — pure dead weight.
 *    Named/saved table views live under `entity-${id}` and are left untouched.
 *
 * 2. SLIM each seeded `contextType:'panel'` default row to a sparse override:
 *    drop every `fieldVisibility` entry whose value already equals the new live
 *    registry default (`showInPanel !== false`), keeping only genuine deviations
 *    (e.g. a field a user toggled, or a seed artifact that diverges from the
 *    registry). If nothing remains AND `fieldOrder` is still the registry
 *    (`systemSortOrder`) order, the row is fully covered by live defaults and is
 *    deleted; otherwise the slimmed row is kept so the read path (`useFieldView`
 *    → `resolveFieldVisible`) layers the remaining deltas over the registry.
 *
 * Idempotent: re-running slims an already-sparse row to itself (all remaining
 * entries are deviations) and finds no dead table rows, so it no-ops.
 *
 * Only touches `isDefault:true && isShared:true` rows keyed by a bare
 * `entityDefinitionId` — the seeded system defaults. User-created named views
 * (a real name, keyed `entity-${id}`) are never matched.
 */
export const migration046LayeredDefaultViews: EntityMigration = {
  id: '046-layered-default-views',
  description: 'Drop dead table default views + slim seeded panel defaults to sparse overrides',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    let changed = false

    // EntityDefinitions for this org — their ids are the bare `tableId`s the old
    // seeder used, and they map tableId → entityType for registry lookups.
    const defs = await db
      .select({ id: schema.EntityDefinition.id, entityType: schema.EntityDefinition.entityType })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId))

    const entityDefIds = defs.map((d) => d.id)
    if (entityDefIds.length === 0) return { ...state, alreadyUpToDate: true }

    const defIdToType = new Map(defs.map((d) => [d.id, d.entityType]))

    // ── Step 1: delete the dead contextType='table' default rows ──────────────
    // Guarded by `tableId ∈ entityDefIds` so named/saved table views (keyed
    // `entity-${id}`, never a bare EntityDefinition id) are never deleted.
    const deletedTable = await db
      .delete(schema.TableView)
      .where(
        and(
          eq(schema.TableView.organizationId, organizationId),
          eq(schema.TableView.isDefault, true),
          eq(schema.TableView.contextType, 'table'),
          inArray(schema.TableView.tableId, entityDefIds)
        )
      )
      .returning({ id: schema.TableView.id })
    if (deletedTable.length > 0) changed = true

    // ── Step 2: slim the seeded contextType='panel' default rows ──────────────
    const panelRows = await db
      .select({
        id: schema.TableView.id,
        tableId: schema.TableView.tableId,
        config: schema.TableView.config,
      })
      .from(schema.TableView)
      .where(
        and(
          eq(schema.TableView.organizationId, organizationId),
          eq(schema.TableView.isDefault, true),
          eq(schema.TableView.isShared, true),
          eq(schema.TableView.contextType, 'panel'),
          inArray(schema.TableView.tableId, entityDefIds)
        )
      )

    if (panelRows.length > 0) {
      // customFieldId → systemAttribute, to resolve a resourceFieldId
      // (`${entityDefId}:${customFieldId}`) to its registry field def.
      const fields = await db
        .select({
          id: schema.CustomField.id,
          systemAttribute: schema.CustomField.systemAttribute,
        })
        .from(schema.CustomField)
        .where(eq(schema.CustomField.organizationId, organizationId))
      const fieldIdToSysAttr = new Map(fields.map((f) => [f.id, f.systemAttribute]))

      // Per-entityType systemAttribute → registry ResourceField.
      const registryByType = new Map<string, Map<string, ResourceField>>()
      const registryFor = (entityType: string): Map<string, ResourceField> | undefined => {
        if (registryByType.has(entityType)) return registryByType.get(entityType)
        const defsForType = RESOURCE_FIELD_REGISTRY[entityType]
        if (!defsForType) {
          registryByType.set(entityType, new Map())
          return registryByType.get(entityType)
        }
        const bySysAttr = new Map<string, ResourceField>()
        for (const field of Object.values(defsForType)) {
          if (field.systemAttribute) bySysAttr.set(field.systemAttribute, field)
        }
        registryByType.set(entityType, bySysAttr)
        return bySysAttr
      }

      for (const row of panelRows) {
        const entityType = defIdToType.get(row.tableId)
        if (!entityType) continue
        const bySysAttr = registryFor(entityType)
        if (!bySysAttr) continue

        const resolveField = (resourceFieldId: string): ResourceField | undefined => {
          const colon = resourceFieldId.indexOf(':')
          const customFieldId = colon === -1 ? resourceFieldId : resourceFieldId.slice(colon + 1)
          const sysAttr = fieldIdToSysAttr.get(customFieldId)
          if (!sysAttr) return undefined
          return bySysAttr.get(sysAttr)
        }
        // Live registry default: hidden only when showInPanel === false.
        const registryVisible = (resourceFieldId: string): boolean =>
          resolveField(resourceFieldId)?.showInPanel !== false

        const config = row.config as FieldViewConfig
        const fieldVisibility = config.fieldVisibility ?? {}

        const slim: Record<string, boolean> = {}
        for (const [resourceFieldId, visible] of Object.entries(fieldVisibility)) {
          if (visible !== registryVisible(resourceFieldId)) slim[resourceFieldId] = visible
        }

        const slimCount = Object.keys(slim).length
        const originalCount = Object.keys(fieldVisibility).length

        // Is fieldOrder still the registry (systemSortOrder) order it was seeded in?
        const fieldOrder = config.fieldOrder ?? []
        const sortedOrder = [...fieldOrder].sort((a, b) => {
          const sa = resolveField(a)?.systemSortOrder ?? 'zz'
          const sb = resolveField(b)?.systemSortOrder ?? 'zz'
          return sa.localeCompare(sb)
        })
        const orderIsDefault =
          fieldOrder.length === sortedOrder.length &&
          fieldOrder.every((id, i) => id === sortedOrder[i])

        if (slimCount === 0 && orderIsDefault) {
          // Fully covered by live registry defaults + order → drop the row.
          await db.delete(schema.TableView).where(eq(schema.TableView.id, row.id))
          changed = true
        } else if (slimCount !== originalCount) {
          // Some entries were dropped → persist the slimmed sparse override,
          // preserving fieldOrder + showLabels for the read path to layer on.
          await db
            .update(schema.TableView)
            .set({
              config: { ...config, fieldVisibility: slim },
              updatedAt: new Date(),
            })
            .where(eq(schema.TableView.id, row.id))
          changed = true
        }
        // else: already sparse (no entries matched a default) → idempotent no-op.
      }
    }

    if (changed) logger.info('Migration 046 applied', { organizationId })
    return { ...state, alreadyUpToDate: !changed }
  },
}
