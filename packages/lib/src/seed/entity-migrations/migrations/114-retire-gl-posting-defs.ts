// packages/lib/src/seed/entity-migrations/migrations/114-retire-gl-posting-defs.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:114')

/**
 * The two entity types this migration removes.
 *
 * Frozen as local string literals, the discipline
 * `062-remove-inbox-lens-personal-fields.ts` and
 * `057-remove-signature-visibility-field.ts` both use: the registry no longer
 * names them, `EntityDefinition.entityType` is a plain `text` column, and a
 * migration is a snapshot that must not break when a sibling constant is edited.
 */
const RETIRED_ENTITY_TYPES = ['gl_posting', 'gl_posting_line'] as const

/**
 * Migration 114: retire the `gl_posting` and `gl_posting_line` **entity
 * definitions**, superseded by the `GlPosting` / `GlPostingLine` Drizzle tables.
 *
 * ## Why the defs are going
 *
 * Decision `G6` (plans/money/decisions.md) moved postings to real tables. The
 * argument is not preference: the entire double-post defence is
 * `INSERT … ON CONFLICT (organizationId, postingType, periodKey, revision) DO
 * NOTHING`, and `FieldValue` carries exactly two unique indexes — the PK and
 * `(entityId, fieldId, sortKey)` — so a composite uniqueness constraint across
 * two FIELDS of an instance is not merely unimplemented, it is **unexpressible**.
 * A unique index constrains within a row, and two fields are two rows.
 *
 * Leaving the defs behind would keep a second, empty, diverging model of the
 * same thing: two vocabularies for posting type (6 values here against the
 * pgEnum's 8), two for status (this one is missing `reversed` entirely), and a
 * hidden `entityType` that a future app field could be declared against and then
 * silently skipped forever — the exact `D10` warn-and-skip hazard that removed
 * `deal` / `task` / `user` from `EntityRefKind`.
 *
 * 🛑 **`gl_account` is NOT touched.** It stays an `EntityInstance` on purpose:
 * `RecordIdentity` is keyed on an instance and has no other addressing mode, and
 * decision `P2` hangs the provider's account id there. That is why `gl_account`
 * was admitted to `EntityRefKind` in the first place. Do not extend this
 * migration to it.
 *
 * ## Why this is safe to run now
 *
 * The defs are empty and — verified 2026-08-28 — **unreachable**:
 *
 *  - **0 `EntityInstance` rows** across all 28 organizations, therefore 0
 *    `FieldValue` rows and 0 `TableView` rows.
 *  - The only relationship in play is internal to the pair
 *    (`gl_posting_line_gl_posting` and its inverse `gl_posting_lines`). No other
 *    entity carries a field pointing at either def.
 *  - `packages/lib/src/money/quickbooks/post-journal-entry.ts` keys its primary
 *    idempotency layer on the `gl_posting` id map — and has **no production
 *    caller**, only its own test file. So the layer protects nothing today. It
 *    is rewritten onto the table's unique index by
 *    plans/money/tasks/10-the-poster.md, and its header now says so.
 *
 * The guard below re-checks the instance count per organization rather than
 * trusting that survey. A def with rows is a def somebody started using, and
 * dropping it would destroy general-ledger history with no way to reconstruct
 * it — so this fails **closed** and loudly.
 *
 * ## What it deletes, in order
 *
 * `FieldValue` → `CustomField` → `EntityDefinition`. Bottom-up, because a
 * left-behind `CustomField` row is worse than none at all: the resource registry
 * RETURNS unmatched DB rows (`resource-registry-service.mergeSystemAndCustomFields`),
 * so an orphan surfaces as a nameless custom field.
 *
 * Cache invalidation is the runner's job — `runEntityMigrationForAllOrgs`
 * recomputes `entityDefs` / `entityDefSlugs` / `customFields` / `resources` for
 * any org whose result is not `alreadyUpToDate`. Do not hand-roll it here.
 *
 * ## Ordering
 *
 * 114, not 113: the NNN id space is shared across `data-migrations/` and
 * `seed/entity-migrations/`, and 113 was already consumed by a transient
 * `113-vendor-bill-balance` that left an `applied` ledger row behind with no
 * surviving definition. Counting free numbers from the FILES on disk is not
 * enough — check the ledger too.
 *
 * MUST sort after 103 (which created `gl_posting`) and 108 (which created
 * `gl_posting_line` and hung `gl_posting.lines` off it). Both have been gutted
 * of that work, so on a fresh database nothing is ever created and this
 * migration is a no-op; on an existing one it is the only thing that removes
 * what they already made. `ensureEntityDefinitions` **skips an org that already
 * holds the def**, so editing the constants alone reaches new orgs only — this
 * migration is the other half of that change, not a tidy-up.
 *
 * Idempotent — a second run finds no matching definitions and returns
 * `alreadyUpToDate`, writing nothing.
 */
export const migration114RetireGlPostingDefs: EntityMigration = {
  id: '114-retire-gl-posting-defs',
  description:
    'Retire the gl_posting and gl_posting_line entity definitions, superseded by the GlPosting / GlPostingLine tables (decision G6). Leaves gl_account alone.',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const defIds = RETIRED_ENTITY_TYPES.map((type) => existing.entityDefs.get(type)?.id).filter(
      (id): id is string => !!id
    )

    if (defIds.length === 0) {
      return { ...state, alreadyUpToDate: true }
    }

    // ── The guard. Fails CLOSED on any surviving row. ────────────────────────
    // Checked per organization rather than trusting the global survey: a def
    // holding instances is a def somebody began posting to, and deleting it
    // would destroy ledger history that nothing can reconstruct. Cheaper to
    // stop the whole migration than to be wrong once.
    const instances = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.entityDefinitionId, defIds))
      .limit(5)

    if (instances.length > 0) {
      throw new Error(
        `Organization ${organizationId} holds ${instances.length}+ gl_posting / gl_posting_line instance(s); refusing to drop the definitions. These entity defs were superseded by the GlPosting / GlPostingLine tables (decision G6) and were expected to be empty. Migrate the rows onto the tables before retiring the defs. Instances: ${instances
          .map((r) => r.id)
          .join(', ')}`
      )
    }

    const fields = await db
      .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          inArray(schema.CustomField.entityDefinitionId, defIds)
        )
      )

    const fieldIds = fields.map((f) => f.id)

    // Expected to delete nothing — the instance guard above already proved there
    // are no instances, and a FieldValue cannot exist without one. Run anyway:
    // an orphaned value row would otherwise outlive its field and its def, and
    // become unreachable rather than merely wrong.
    if (fieldIds.length > 0) {
      await db.delete(schema.FieldValue).where(inArray(schema.FieldValue.fieldId, fieldIds))
      await db.delete(schema.CustomField).where(inArray(schema.CustomField.id, fieldIds))
    }

    await db.delete(schema.EntityDefinition).where(inArray(schema.EntityDefinition.id, defIds))

    logger.info('Migration 114 applied', {
      organizationId,
      definitionsRemoved: defIds.length,
      fieldsRemoved: fieldIds.length,
      attributes: fields.map((f) => f.systemAttribute),
    })

    // NOT `alreadyUpToDate` — definitions were removed, so the runner must
    // recompute this org's `entityDefs` / `entityDefSlugs` / `customFields` /
    // `resources` cache entries. Reporting up-to-date here would leave every
    // reader serving a def that no longer exists.
    return { ...state, alreadyUpToDate: false }
  },
}
