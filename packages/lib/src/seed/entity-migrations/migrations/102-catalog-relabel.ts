// packages/lib/src/seed/entity-migrations/migrations/102-catalog-relabel.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:102')

/**
 * The two catalog defs whose seeded labels change
 * (plans/products/01-product-family.md §6). Labels ONLY — `entityType`,
 * `apiSlug`, the `catalog_item_*` systemAttributes and every slug-keyed
 * reference stay exactly as they are.
 */
export const CATALOG_RELABELS = [
  {
    entityType: 'catalog_item',
    old: { singular: 'Product / Service', plural: 'Products & Services' },
    next: { singular: 'Catalog Item', plural: 'Catalog Items' },
  },
  {
    entityType: 'catalog_group',
    old: { singular: 'Product Group', plural: 'Product Groups' },
    next: { singular: 'Catalog Group', plural: 'Catalog Groups' },
  },
] as const

export type CatalogRelabelSpec = (typeof CATALOG_RELABELS)[number]

/**
 * Decide what to do with one org's def row.
 *
 * - `update`     — both labels still carry the exact old seeded values.
 * - `up-to-date` — both labels already carry the new values (re-run no-op).
 * - `skip`       — anything else: the org customized at least one label, and a
 *   customized label is theirs — the migration only replaces what the seeder
 *   wrote. A half-old row (one label customized, one still seeded) is skipped
 *   whole rather than half-migrated.
 */
export function resolveRelabel(
  labels: { singular: string; plural: string },
  spec: CatalogRelabelSpec
): 'update' | 'up-to-date' | 'skip' {
  if (labels.singular === spec.next.singular && labels.plural === spec.next.plural) {
    return 'up-to-date'
  }
  if (labels.singular === spec.old.singular && labels.plural === spec.old.plural) {
    return 'update'
  }
  return 'skip'
}

/**
 * Migration 102: relabel the sellable catalog defs — `catalog_item` from
 * "Product / Service" to "Catalog Item" and `catalog_group` from
 * "Product Group" to "Catalog Group" (plans/products/01-product-family.md §6),
 * so the word "Product" is freed up for the `product` family entity that
 * migration 101 added.
 *
 * The seeder helpers are insert-only (`ensureEntityDefinitions` skips existing
 * rows), so every org seeded before this change keeps the old labels forever
 * without an explicit UPDATE. Only rows still carrying BOTH exact old seeded
 * labels are touched; a def whose labels an org customized is left alone and
 * the skip is logged ({@link resolveRelabel}).
 *
 * Idempotent — a re-run finds the new labels and reports `alreadyUpToDate`.
 * Cache invalidation is handled by the runner: any org whose result is not
 * `alreadyUpToDate` gets `entityDefs` / `entityDefSlugs` / `customFields` /
 * `resources` recomputed.
 */
export const migration102CatalogRelabel: EntityMigration = {
  id: '102-catalog-relabel',
  description:
    'Relabel catalog_item to "Catalog Item" and catalog_group to "Catalog Group" (labels only, seeded values only)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const defs = await db
      .select({
        id: schema.EntityDefinition.id,
        entityType: schema.EntityDefinition.entityType,
        singular: schema.EntityDefinition.singular,
        plural: schema.EntityDefinition.plural,
      })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          inArray(
            schema.EntityDefinition.entityType,
            CATALOG_RELABELS.map((r) => r.entityType)
          ),
          isNull(schema.EntityDefinition.archivedAt)
        )
      )

    let updated = 0
    for (const spec of CATALOG_RELABELS) {
      const def = defs.find((d) => d.entityType === spec.entityType)
      // Org predates the def entirely — the seeder/migration that creates it
      // already carries the new labels, so there is nothing to do here.
      if (!def) continue

      const action = resolveRelabel(def, spec)
      if (action === 'up-to-date') continue
      if (action === 'skip') {
        logger.info('Catalog def labels customized — leaving them alone', {
          organizationId,
          entityType: spec.entityType,
          singular: def.singular,
          plural: def.plural,
        })
        continue
      }

      await db
        .update(schema.EntityDefinition)
        .set({ singular: spec.next.singular, plural: spec.next.plural })
        .where(eq(schema.EntityDefinition.id, def.id))
      updated += 1
    }

    if (updated > 0) {
      logger.info('Migration 102 applied', { organizationId, defsRelabeled: updated })
    }

    return { ...state, alreadyUpToDate: updated === 0 }
  },
}
