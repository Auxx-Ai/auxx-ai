// packages/lib/src/seed/entity-migrations/migrations/124-build-batch-source-and-period.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { FieldOptions } from '../../../custom-fields'
import { BuildSource } from '../../../resources/registry/enum-values'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:124')

/** The def that receives all of this. Created by migration 109. */
const BUILD_ENTITY_TYPE = 'build'

/** The field whose stored `options` JSONB has to learn about `batch`. */
const BUILD_SOURCE_ATTRIBUTE = 'build_source'

/**
 * Listed by REGISTRY KEY rather than taken as "everything new on
 * `BUILD_FIELDS`", so a later unrelated field cannot silently join this
 * migration's payload. The same discipline 109, 111 and 119 record.
 */
const FIELD_KEYS = ['periodStart', 'periodEnd'] as const

/** One stored option, as `CustomField.options.options[]` holds it. */
interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/**
 * Append every wanted option the stored list does not already carry, returning
 * the new list or `null` when nothing is missing.
 *
 * 🛑 **Append, never replace.** `108-purchasing.ts`'s `refreshSelectOptions`
 * rewrites the whole array from the registry when the `value` keys differ, which
 * here would also restate `Manual` and `Order` — discarding any label or colour
 * an org set on them. 118 records why that matters: only the thing that actually
 * changed should be written. Existing entries are preserved verbatim, in order,
 * and `value` is never touched, because `FieldValue.optionId` stores that key
 * and rewriting one orphans every build that carries it.
 *
 * Pure, so the rule is testable without a database.
 */
export function appendMissingOptions(
  stored: readonly StoredOption[],
  wanted: readonly { value: string; label: string; color: string }[]
): StoredOption[] | null {
  const present = new Set(stored.map((option) => option.value))
  const missing = wanted.filter((option) => !present.has(option.value))
  if (missing.length === 0) return null
  return [...stored, ...missing]
}

/**
 * Migration 124: `BuildSource.batch`, and the two demand-period fields a batch
 * build claims (plans/money/tasks/44-auto-build-cutoff-and-backfill.md §6, §11.1
 * phase 0).
 *
 * ## What it adds
 *
 * 1. `batch` on `build_source`, beside `manual` and `order`.
 * 2. `build_period_start` / `build_period_end` on the `build` def.
 *
 * ## 🛑 Why the enum edit alone reaches no existing org
 *
 * `build-fields.ts` declares `options: { options: BuildSource.values }`, and
 * those options are **materialized into `CustomField.options` JSONB at seed
 * time**. `mergeSystemAndCustomFields` reads them off the DB row, never off the
 * registry — `106-supplier-pricing-relabel.ts` and `118-movement-type-relabel.ts`
 * both exist for exactly this reason. Without this migration a batch build would
 * write an `optionId` of `batch` that no stored option matches, and the records
 * view, the filter dropdown and the Details panel would all render it as blank
 * while the registry-backed surfaces read `Batch`.
 *
 * ## Inert on arrival
 *
 * Nothing writes `batch` or either period field until the bulk builder lands
 * (§11.1 phases 1-4), the same B10 precedent 109 and 111 followed. A value with
 * no writer carries no behavioural risk, and shipping it first is what clears
 * the org-cache and field-exists gates for the code that follows.
 *
 * ## Id space
 *
 * 124 is the next free number counted across BOTH `data-migrations/migrations/`
 * (which reaches 106) and `seed/entity-migrations/migrations/` (which reaches
 * 123), and verified against every local and remote branch — the space is shared
 * and has already collided once, at 103.
 *
 * **No DDL.** The two fields are `CustomField` rows on an existing def and the
 * option is JSONB on an existing row; nothing here touches a Postgres table. If
 * a `.sql` file appears under `packages/database/drizzle/` for this work,
 * something is wrong.
 *
 * Idempotent — `ensureCustomFields` skips a field that already exists, and
 * {@link appendMissingOptions} returns `null` once `batch` is stored.
 */
export const migration124BuildBatchSourceAndPeriod: EntityMigration = {
  id: '124-build-batch-source-and-period',
  description:
    'Add the batch build source and the build_period_start / build_period_end demand-period ' +
    'pair, so a batch build can claim a period instead of carrying its orders',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(BUILD_ENTITY_TYPE)
    // Absent rather than failed: an org short of migration 109 has no `build`
    // def, and 109 seeds the full registry — including these two fields and the
    // three-value option list — so a later run picks the whole thing up on its
    // own.
    if (!def) return { ...state, alreadyUpToDate: true }

    // ── The two demand-period fields ───────────────────────────────────
    const fields: Record<string, ResourceField> = {}
    for (const key of FIELD_KEYS) {
      const field = BUILD_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make
      // this migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`build registry is missing the key "${key}" (migration 124)`)
      }
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, BUILD_ENTITY_TYPE, def.id, fields, existing, state)

    // ── `batch` on the stored build_source options ─────────────────────
    const optionsAdded = await addBatchSourceOption(db, organizationId, def.id)

    const changed = state.fieldsCreated > 0 || optionsAdded
    const alreadyUpToDate = !changed

    // A new field, and a new option on an existing one, are both invisible to
    // every read path until the per-org caches that serve them are dropped.
    // `runEntityMigrationsForOrg` does this after the whole batch, but `up()`
    // can also be invoked directly, so it clears its own.
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 124 applied', { organizationId, ...state, optionsAdded })
    }

    return { ...state, alreadyUpToDate }
  },
}

/**
 * Add `batch` to the org's stored `build_source` options, preserving everything
 * already there. Returns whether a row was written.
 */
async function addBatchSourceOption(
  db: Database,
  organizationId: string,
  entityDefId: string
): Promise<boolean> {
  const field = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.entityDefinitionId, entityDefId),
      eq(schema.CustomField.systemAttribute, BUILD_SOURCE_ATTRIBUTE)
    ),
    columns: { id: true, options: true },
  })
  // An org whose `build` def predates the `source` field has nothing to widen;
  // `ensureCustomFields` in a later 109 run creates it with all three values.
  if (!field) return false

  const stored = (field.options as { options?: StoredOption[] } | null)?.options
  if (!Array.isArray(stored)) return false

  const next = appendMissingOptions(stored, BuildSource.values)
  if (!next) return false

  await db
    .update(schema.CustomField)
    .set({
      options: { ...(field.options as FieldOptions), options: next },
      updatedAt: new Date(),
    })
    .where(eq(schema.CustomField.id, field.id))

  return true
}
