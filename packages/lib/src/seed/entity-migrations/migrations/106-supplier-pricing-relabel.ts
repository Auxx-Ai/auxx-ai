// packages/lib/src/seed/entity-migrations/migrations/106-supplier-pricing-relabel.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:106')

/**
 * The two hidden join defs whose seeded labels change
 * (plans/importer/08-named-importers.md §3 D-B). Labels ONLY — `entityType`,
 * `apiSlug`, every `vendor_part_*` / `subpart_*` systemAttribute and every
 * slug-keyed reference stay exactly as they are.
 */
export const SUPPLIER_PRICING_DEF_RELABELS = [
  {
    entityType: 'vendor_part',
    old: { singular: 'Vendor Part', plural: 'Vendor Parts' },
    next: { singular: 'Supplier Price', plural: 'Supplier Pricing' },
  },
  {
    entityType: 'subpart',
    old: { singular: 'Subpart', plural: 'Subparts' },
    next: { singular: 'Component', plural: 'Components' },
  },
] as const

/**
 * The part-side relation fields whose labels name the join entity.
 *
 * ⚠️ These are the labels users actually read — `mergeSystemAndCustomFields`
 * takes `label` from the DB row (`CustomField.name`), never from the registry, so
 * relabelling `part-fields.ts` alone changes nothing for an org that already
 * exists. That is the whole reason this half of the migration is here.
 */
export const SUPPLIER_PRICING_FIELD_RELABELS = [
  { systemAttribute: 'part_vendor_parts', old: 'Vendor Parts', next: 'Supplier Pricing' },
  { systemAttribute: 'part_subparts', old: 'Subparts', next: 'Components' },
  { systemAttribute: 'part_used_in_assemblies', old: 'Used In Assemblies', next: 'Used In' },
] as const

/**
 * Decide what to do with one seeded label.
 *
 * - `update`     — still carries the exact old seeded value.
 * - `up-to-date` — already carries the new value (re-run no-op).
 * - `skip`       — anything else: the org renamed it, and a customized label is
 *   theirs. This migration only replaces what the seeder wrote.
 *
 * Mirrors `resolveRelabel` in 102-catalog-relabel, deliberately — same problem,
 * same rule, and divergence between the two would be a trap.
 */
export function resolveLabel(
  current: string,
  spec: { old: string; next: string }
): 'update' | 'up-to-date' | 'skip' {
  if (current === spec.next) return 'up-to-date'
  if (current === spec.old) return 'update'
  return 'skip'
}

/** As {@link resolveLabel}, for a def's singular/plural pair, which move together. */
export function resolveDefRelabel(
  labels: { singular: string; plural: string },
  spec: { old: { singular: string; plural: string }; next: { singular: string; plural: string } }
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
 * Migration 106: relabel the hidden join entities and the part-side relations
 * that name them — `vendor_part` to "Supplier Pricing" and `subpart` to
 * "Components" (plans/importer/08-named-importers.md §3 D-B).
 *
 * These defs are deliberately invisible: no sidebar entry, no records page. But
 * their NAMES still surfaced — in the import picker, the import wizard header,
 * and import history — which leaks the join entity just as surely as a sidebar
 * link would (02-design.md §6.2). Naming them for what they hold to the user
 * ("Supplier Pricing", not "Vendor Parts") is what closes that, and it is the
 * prerequisite for named importers: an "Import supplier prices" menu item that
 * opens a wizard titled "Vendor Parts" has given the game away.
 *
 * The seeder helpers are insert-only, so an org seeded before this change keeps
 * the old labels forever without an explicit UPDATE. Only rows still carrying the
 * exact old seeded value are touched; a label the org customized is left alone
 * ({@link resolveLabel}).
 *
 * Idempotent — a re-run finds the new labels and reports `alreadyUpToDate`.
 * Cache invalidation is the runner's job: any org whose result is not
 * `alreadyUpToDate` gets `entityDefs` / `entityDefSlugs` / `customFields` /
 * `resources` recomputed.
 */
export const migration106SupplierPricingRelabel: EntityMigration = {
  id: '106-supplier-pricing-relabel',
  description: 'Relabel vendor_part/subpart defs and the part-side relation fields that name them',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    let changed = 0

    // ── Half 1: the def labels ──
    for (const spec of SUPPLIER_PRICING_DEF_RELABELS) {
      const def = await db.query.EntityDefinition.findFirst({
        where: and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, spec.entityType)
        ),
        columns: { id: true, singular: true, plural: true },
      })
      // An org that never got the def (seeded before it existed, or a fleet where
      // parts are off) is not a failure — there is simply nothing to relabel.
      if (!def) continue

      const action = resolveDefRelabel({ singular: def.singular, plural: def.plural }, spec)
      if (action === 'skip') {
        logger.warn('Migration 106 skipped a customized def label', {
          organizationId,
          entityType: spec.entityType,
          singular: def.singular,
          plural: def.plural,
        })
        continue
      }
      if (action === 'up-to-date') continue

      await db
        .update(schema.EntityDefinition)
        .set({ singular: spec.next.singular, plural: spec.next.plural, updatedAt: new Date() })
        .where(eq(schema.EntityDefinition.id, def.id))
      changed++
    }

    // ── Half 2: the part-side relation field labels ──
    for (const spec of SUPPLIER_PRICING_FIELD_RELABELS) {
      const field = await db.query.CustomField.findFirst({
        where: and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.modelType, 'part'),
          eq(schema.CustomField.systemAttribute, spec.systemAttribute)
        ),
        columns: { id: true, name: true },
      })
      if (!field) continue

      const action = resolveLabel(field.name, spec)
      if (action === 'skip') {
        logger.warn('Migration 106 skipped a customized field label', {
          organizationId,
          systemAttribute: spec.systemAttribute,
          name: field.name,
        })
        continue
      }
      if (action === 'up-to-date') continue

      await db
        .update(schema.CustomField)
        .set({ name: spec.next, updatedAt: new Date() })
        .where(eq(schema.CustomField.id, field.id))
      changed++
    }

    const alreadyUpToDate = changed === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 106 applied', { organizationId, labelsUpdated: changed })
    }

    return { ...state, alreadyUpToDate }
  },
}
