// packages/lib/src/seed/entity-migrations/migrations/139-tax-line-order-writable.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, or } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:139')

/** The attribute whose two flags this migration corrects. Added by migration 136. */
const TAX_LINE_ORDER = 'tax_line_order'

/**
 * Migration 139: make `tax_line_order` optional at create and writable after it.
 *
 * `plans/money/tasks/51-first-sync-defects.md` §1.
 *
 * ## The defect
 *
 * Migration 136 shipped `tax_line_order` as `required: true` and
 * `isUpdatable: false`. Both are wrong for the only writer a tax line has.
 *
 * A connector writes a fanned-out child in TWO passes
 * (`data-connectors/relationship-pass.ts`: *"After all streams sync, resolve each
 * item's pendingRelations ... write the real RELATIONSHIP FieldValue"*). The create
 * carries the leaf values only; the parent edge is written afterwards. So:
 *
 * - `required: true` refuses the create the connector actually makes. It is not a
 *   race with the order's creation - the order exists by then - the create simply
 *   never names a parent, so the requirement can never be met.
 * - `isUpdatable: false` would then refuse the second pass that supplies the edge,
 *   which is why fixing `required` alone would have produced orphan tax lines
 *   instead of rejected ones.
 *
 * Measured on the first real sync (DemoOrg1, run `xe9e6nzi0bf2ub973lfdq2z6`):
 * **1599 rejections, all `Missing required fields: Order`, and zero tax lines**,
 * while `line_item`, `credit_memo` and `credit_memo_line` came through the same
 * fan-out because every one of their parent edges is optional and updatable.
 *
 * ## What it changes
 *
 * `CustomField.required` false and `CustomField.isUpdatable` true, for the
 * `tax_line_order` field in every org that has one. `nullable` is deliberately
 * left alone: the sibling edges carry `nullable: false` too and are unaffected by
 * it, and the column is not what refuses the write.
 *
 * ## Why a migration and not just the registry
 *
 * `ensureCustomFields` never rewrites an existing field, so the registry edit
 * shipped alongside this reaches NEW orgs only. 136 stamped `required: true` on
 * every org that already exists, and only a direct column write clears it.
 *
 * ## Idempotent
 *
 * The update is narrowed to rows that still hold the wrong values, so a re-run
 * reports `alreadyUpToDate`. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 139-tax-line-order-writable`.
 *
 * 🛑 This does NOT re-ingest the tax lines already rejected. A rejected row is not
 * retried; the affected orders have to be synced again (51 §4).
 */
export const migration139TaxLineOrderWritable: EntityMigration = {
  id: '139-tax-line-order-writable',
  description:
    'Makes tax_line_order optional at create and updatable afterwards. Migration 136 shipped ' +
    'it required and read-only, which refused every connector-written tax line with "Missing ' +
    'required fields: Order" (1599 on the first real sync) because a connector supplies a ' +
    "child's parent edge in a second pass, never in the create",

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const updated = await db
      .update(schema.CustomField)
      .set({ required: false, isUpdatable: true })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, TAX_LINE_ORDER),
          // Narrowed to rows that still hold a wrong value. Without this the
          // UPDATE matches on every re-run and `returning()` hands back the row
          // even though nothing changed, so the migration would report
          // `alreadyUpToDate: false` and log forever.
          or(eq(schema.CustomField.required, true), eq(schema.CustomField.isUpdatable, false))
        )
      )
      .returning({ id: schema.CustomField.id })

    if (updated.length === 0) {
      // No tax_line def in this org, or the flags are already correct. Both are
      // fine and neither is worth a log line.
      return { ...state, alreadyUpToDate: true }
    }

    logger.info('Migration 139 made tax_line_order optional and updatable', {
      organizationId,
      fields: updated.length,
    })

    // The field's shape is cached per org; a stale entry would keep refusing the
    // create until something else evicted it. `runEntityMigrationsForOrg` busts the
    // cache after the whole batch, but `up()` is also called directly by
    // `scripts/run-entity-migration.ts`, so do it here too (as 137 does).
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])

    return { ...state, relationshipsLinked: updated.length, alreadyUpToDate: false }
  },
}
