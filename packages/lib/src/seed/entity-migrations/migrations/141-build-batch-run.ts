// packages/lib/src/seed/entity-migrations/migrations/141-build-batch-run.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:141')

/** The def that receives the field. Created by migration 109, widened by 124. */
const BUILD_ENTITY_TYPE = 'build'

/**
 * Listed by REGISTRY KEY rather than taken as "everything new on
 * `BUILD_FIELDS`", so a later unrelated field cannot silently join this
 * migration's payload. The same discipline 109, 111, 119 and 124 record.
 */
const FIELD_KEYS = ['batchRun'] as const

/**
 * Migration 141: `build_batch_run`, the per-org run number every build a batch
 * run creates carries (plans/money/tasks/45-batch-only-builds.md §3).
 *
 * ## What it adds
 *
 * One `CustomField` row on the `build` def: `build_batch_run`, a nullable
 * integer, `creatable` and `updatable: false`. Nothing else. There are no
 * select options to materialize, which is what makes this migration strictly
 * simpler than 124: only the `ensureCustomFields` half of 124's work applies,
 * and none of its append-an-option machinery.
 *
 * ## 🛑 Why the registry edit alone reaches no existing org
 *
 * `build-fields.ts` is the seed for a def's `CustomField` rows, not a live view
 * of them. `mergeSystemAndCustomFields` reads what is stored on the DB row,
 * so a field added to the registry today exists only in orgs seeded after
 * today. 44 §11.2 records this and 109, 111, 119 and 124 all exist for it.
 * Without this migration the batch builder would write a `build_batch_run`
 * value against a field that no existing org has, the filter *"show me run 2"*
 * would have nothing to filter on, and the Undo card (45 §11) would have no
 * handle to hang on.
 *
 * ## Why a scalar and not a `batch_run` entity
 *
 * 45 §3.1: almost everything a run entity would store is already recoverable
 * from the builds themselves (the range and grouping off
 * `build_period_start` / `build_period_end`, the status off `build_status`, the
 * timing off `createdAt`), so an entity would be a second copy of an answer the
 * builds already give. The number is the one thing that is NOT recoverable,
 * because it is what groups the builds of a single run together, so it is the
 * one thing that gets stored.
 *
 * The value comes from `records/record-numbering.ts` under the internal
 * `build_batch` scope, allocated ONCE per run before the first build. 45 §3.2:
 * the increment and read-back are one `UPDATE ... RETURNING`, and a hand-rolled
 * `MAX(build_batch_run) + 1` would hand two concurrent runs the same number,
 * which makes undo reverse production nobody asked to undo.
 *
 * ## Inert on arrival
 *
 * `null` on every order-raised and hand-raised build, and nothing writes it
 * until the batch builder allocates a run number. The same B10 precedent 109,
 * 111 and 124 followed: a field with no writer carries no behavioural risk, and
 * shipping it first is what clears the org-cache and field-exists gates for the
 * code that follows.
 *
 * ## Id space
 *
 * 141 is the next free number counted across BOTH `data-migrations/migrations/`
 * (which reaches 131) and `seed/entity-migrations/migrations/` (which reaches
 * 140, `140-integrations-view`). The space is shared and has already collided
 * once, at 103. 45 §5 said 125, then 140; both went stale between the brief
 * being written and this file existing, which is what 45 §10.9 records. Count
 * both directories at the moment you create the file.
 *
 * **No DDL.** The field is a `CustomField` row on an existing def; nothing here
 * touches a Postgres table. If a `.sql` file appears under
 * `packages/database/drizzle/` for this work, something is wrong.
 *
 * Idempotent: `ensureCustomFields` skips a field that already exists, so a
 * re-run reports `alreadyUpToDate` and writes nothing.
 */
export const migration141BuildBatchRun: EntityMigration = {
  id: '141-build-batch-run',
  description:
    'Add build_batch_run, the per-org batch run number every build a run creates carries, ' +
    'so a run can be filtered for and undone as a unit',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(BUILD_ENTITY_TYPE)
    // Absent rather than failed: an org short of migration 109 has no `build`
    // def, and 109 seeds the full registry (this field included), so a later run
    // picks the whole thing up on its own.
    if (!def) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of FIELD_KEYS) {
      const field = BUILD_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make
      // this migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`build registry is missing the key "${key}" (migration 141)`)
      }
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, BUILD_ENTITY_TYPE, def.id, fields, existing, state)

    const alreadyUpToDate = state.fieldsCreated === 0

    // A new field is invisible to every read path until the per-org caches that
    // serve it are dropped. `runEntityMigrationsForOrg` does this after the
    // whole batch, but `up()` can also be invoked directly, so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 141 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
