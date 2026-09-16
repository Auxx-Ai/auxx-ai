// packages/lib/src/data-migrations/migrations/165-account-subtype-clearing.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { GlAccountSubtype } from '../../resources/registry/enum-values'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:165')

/** The one field whose stored `options` JSONB carries the subtype vocabulary. */
const SUBTYPE_ATTRIBUTE = 'gl_account_subtype'

/** One stored option, as `CustomField.options.options[]` holds it. */
interface StoredOption {
  value: string
  label: string
  [key: string]: unknown
}

/**
 * Merge the registry's option list into an org's stored one, or `null` when
 * nothing changed.
 *
 * 🛑 **An existing option is never rewritten, only repositioned.**
 * `FieldValue.optionId` stores the `value` key (16 rows carry a subtype today,
 * all via `optionId`, none via text), so rewriting a `value` would orphan every
 * stored subtype — the same hazard `118-movement-type-relabel.ts` documents.
 * Here the stored entry is carried through VERBATIM, keeping any label or colour
 * an org edited itself. Only genuinely new values are added.
 *
 * ⚠️ Order follows the registry so `Other` stays last and the three new asset
 * subtypes sit beside the ones they resemble, rather than being appended after
 * `Other` where a dropdown reads oddly. Reordering is safe precisely because
 * `value` — not position — is the identifier.
 *
 * ⚠️ An option the registry does not know about is an org's own addition. It is
 * kept, at the end, rather than dropped.
 *
 * Pure, so the rule is testable without a database.
 */
export function mergeSubtypeOptions(
  stored: readonly StoredOption[],
  registry: readonly StoredOption[]
): StoredOption[] | null {
  const byValue = new Map(stored.map((option) => [option.value, option]))
  const known = new Set(registry.map((option) => option.value))
  const merged: StoredOption[] = [
    ...registry.map((option) => byValue.get(option.value) ?? option),
    ...stored.filter((option) => !known.has(option.value)),
  ]
  const added = merged.length - stored.length
  const reordered = merged.some((option, index) => stored[index]?.value !== option.value)
  return added > 0 || reordered ? merged : null
}

/**
 * Migration 165: add `clearing`, `reserve_balances` and `stored_balances` to
 * every org's `gl_account.subtype` options.
 *
 * ## 🛑 Why the enum edit alone is not enough
 *
 * `gl-account-fields.ts` declares `options: { options: GlAccountSubtype.values }`,
 * and those options are **materialized into `CustomField.options` JSONB at seed
 * time**. `mergeSystemAndCustomFields` reads them from the DB row, never from
 * the registry. So after the registry edit and before this migration the three
 * new subtypes exist in code, are accepted by `GL_ACCOUNT_SUBTYPES` and by the
 * QuickBooks type mapping — and cannot be SELECTED on any chart screen, because
 * the dropdown is built from the stored list.
 *
 * Additive only: no existing option is rewritten, no stored `FieldValue` is
 * touched, and no account changes its subtype. Idempotent — a re-run finds all
 * eleven values present and reports `alreadyUpToDate`.
 */
export const migration165AccountSubtypeClearing: PerOrgMigration = {
  id: '165-account-subtype-clearing',
  description: 'Adds clearing, reserve and stored balance subtypes to the chart of accounts.',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const field = await db.query.CustomField.findFirst({
      where: and(
        eq(schema.CustomField.organizationId, organizationId),
        eq(schema.CustomField.systemAttribute, SUBTYPE_ATTRIBUTE)
      ),
      columns: { id: true, options: true },
    })
    // An org whose chart was never provisioned has no field to widen. Not a
    // failure: the seeder writes the full list when it does run.
    if (!field) return { ...state, alreadyUpToDate: true }

    const stored = (field.options as { options?: StoredOption[] } | null)?.options
    if (!Array.isArray(stored)) return { ...state, alreadyUpToDate: true }

    const next = mergeSubtypeOptions(stored, GlAccountSubtype.values as StoredOption[])
    if (!next) return { ...state, alreadyUpToDate: true }

    await db
      .update(schema.CustomField)
      .set({
        options: { ...(field.options as Record<string, unknown>), options: next },
        updatedAt: new Date(),
      })
      .where(eq(schema.CustomField.id, field.id))

    logger.info('Migration 165 applied', {
      organizationId,
      optionsBefore: stored.length,
      optionsAfter: next.length,
    })

    return { ...state, alreadyUpToDate: false }
  },
}
