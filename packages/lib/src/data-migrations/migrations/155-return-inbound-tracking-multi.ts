// packages/lib/src/data-migrations/migrations/155-return-inbound-tracking-multi.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:155')

/**
 * The attribute this migration retypes. One field, one org at a time.
 *
 * Held as a literal for the reason 150, 132 and 144 hold theirs: this is the
 * VALUE the migration matches on, not a reference to whatever the registry
 * constant says later.
 */
const INBOUND_TRACKING_ATTRIBUTE = 'return_inbound_tracking'

/**
 * Migration 155: make `return.inboundTracking` a MULTI-VALUE field.
 *
 * `plans/money/tasks/57-return-intake-wizard.md` §8.1.
 *
 * ## Why
 *
 * The return-intake wizard groups photographed labels by `(customer, order)`,
 * and one customer may ship three boxes against one order. That return then has
 * three inbound tracking numbers and a single-valued TEXT field has room for
 * one. `options.multi = true` is the same declaration `contact.primaryEmail`
 * carries, with the first value by `sortKey` as the primary.
 *
 * ## Why a migration, and not just the registry edit
 *
 * 🛑 A registry edit reaches **no existing org**. `ensureCustomFields` is
 * INSERT-only and, as 54 §11 item 3 records in a different context, *"never
 * rewrites an existing field's options"* — so every org created before this
 * still holds a single-valued row. This sets the flag on the row itself.
 *
 * ## What this does NOT do, deliberately
 *
 * **No value rewrite.** A single-valued `FieldValue` is already a valid
 * multi-value set of size one: the multi-value read path orders by `sortKey`
 * and takes them all, and a lone row with a null or default `sortKey` is a
 * one-element list. There is nothing to migrate on the value side, which is why
 * this migration touches `CustomField` only.
 *
 * ⚠️ **No `return_parcel` def.** Binding a tracking number to the photo and the
 * sender it came from needs a child definition, which 57 §8.2 rejected for v1.
 * That binding is genuinely lost, not merely unmodelled, and 57 §6.4 records it
 * as accepted rather than pending.
 *
 * ## Bulk, never a per-row loop
 *
 * One `UPDATE` per org, `jsonb ||` merging the key in so any other stored
 * option survives. The predicate is "the row is not already multi", so the
 * statement is a no-op on an org that has run this.
 *
 * **No DDL.** This rewrites `CustomField.options`; nothing here touches a
 * Postgres table. If a `.sql` file appears under `packages/database/drizzle/`
 * for this work, something is wrong.
 *
 * ## Idempotent
 *
 * A re-run matches nothing, because the predicate is the negation of what it
 * writes — `alreadyUpToDate: true`, nothing written. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 155-return-inbound-tracking-multi`.
 *
 * ## 🛑 The 55 lesson applies to verifying this
 *
 * Retyping `order_fulfillments` from JSON to a relationship produced **no
 * compile error and no failing test** — ratchet 27/27, 1,228 tests green on a
 * half-migrated tree — because field access is untyped at the boundary and the
 * money tests mock the field layer. **Treat green as evidence of nothing here
 * too.** The worklist for this change is a grep of `return_inbound_tracking`
 * and `inboundTracking` across `packages/lib/src` and `apps/web/src`, not a
 * test run.
 */
export const migration155ReturnInboundTrackingMulti: PerOrgMigration = {
  id: '155-return-inbound-tracking-multi',
  description:
    'Make return.inboundTracking multi-value, so one return can carry a tracking number per ' +
    'parcel — the intake wizard groups labels by (customer, order) and one customer may ship ' +
    'several boxes against one order. CustomField.options only; no value rewrite is needed ' +
    'because a single stored value is already a valid one-element multi-value set',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const updated = await db
      .update(schema.CustomField)
      .set({
        options: sql`coalesce(${schema.CustomField.options}, '{}'::jsonb) || '{"multi": true}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, INBOUND_TRACKING_ATTRIBUTE),
          // Not already multi. `->` returns JSON `true` only when the key is set
          // to boolean true, so a missing key and an explicit false both match.
          sql`coalesce(${schema.CustomField.options} -> 'multi', 'false'::jsonb) <> 'true'::jsonb`
        )
      )
      .returning({ id: schema.CustomField.id })

    if (updated.length === 0) {
      return { ...state, alreadyUpToDate: true }
    }

    // The direct `CustomField` write bypasses the org cache, and every renderer
    // and every field read resolves a field's options from it — a stale entry
    // would keep treating the field as single-valued, so a second tracking
    // number would overwrite the first instead of appending. `perOrgMigration`
    // flushes after the whole batch, but `up()` is also called directly by
    // `scripts/run-entity-migration.ts`, so do it here too (as 137, 139, 144
    // and 150 do).
    await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
    logger.info('Migration 155 applied', { organizationId, updated: updated.length })

    return { ...state, alreadyUpToDate: false }
  },
}
