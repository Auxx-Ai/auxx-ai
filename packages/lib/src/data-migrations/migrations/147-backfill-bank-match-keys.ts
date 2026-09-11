// packages/lib/src/data-migrations/migrations/147-backfill-bank-match-keys.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, like } from 'drizzle-orm'
import { normalizeMatchKey } from '../../banking/feed/match-key'
import { fieldKey, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:147')

const BANK_TRANSACTION_ENTITY_TYPE = 'bank_transaction'
const DESCRIPTION_ATTRIBUTE = 'bank_transaction_description'
const MATCH_KEY_ATTRIBUTE = 'bank_transaction_match_key'
const EXTERNAL_ID_ATTRIBUTE = 'bank_transaction_external_id'

/** The prefix `buildImportedExternalId` stamps on an id it synthesised for a file row. */
const SYNTHESISED_EXTERNAL_ID_PREFIX = 'imp:'

/** One `FieldValue` row, as narrow as the recompute needs it. */
interface KeyRow {
  id: string
  fieldId: string
  entityId: string
  valueText: string | null
}

/** What this migration reports. Counters, never a per-row loop. */
interface Outcome {
  rewritten: number
  inserted: number
  cleared: number
  unchanged: number
  synthesisedExternalIds: number
}

/**
 * Migration 147: every stored `bank_transaction.matchKey` is recomputed from the
 * row's own `description` with the CURRENT `normalizeMatchKey`
 * (`plans/accounting/tasks/11-clearing-the-review-queue.md`, the LANDED block's
 * follow-ups 1 and 2).
 *
 * ## Why a backfill exists at all
 *
 * `matchKey` is the one derived value in this subsystem that is STORED rather than
 * computed at read time - written once at ingest by
 * `data-connectors/connectors/stripe-financial-connections.ts` and
 * `banking/import/finalize.ts`, and never recomputed. So a rule added to the
 * normaliser reaches new lines only, and the queue keeps grouping the rows it
 * already holds by the old keys forever. On the measured feed that is the whole
 * corpus: 489 lines, all of them ingested before the rule landed.
 *
 * ## What it does, per org
 *
 * One SELECT reads every `description` and `matchKey` value on the org's
 * `bank_transaction` rows together. For each instance the new key is
 * `normalizeMatchKey(description)`, and then:
 *
 * - equal to what is stored → left alone (this is what makes a second run a no-op)
 * - different and non-empty → the `matchKey` row is UPDATEd, or INSERTed when the
 *   instance never had one
 * - newly empty (a bare check number, a description that was nothing but a
 *   reference) → the stored value is set NULL, because '' is "no key" and a
 *   stored '' would group through `readHistoryForMatchKey`'s equality match
 *
 * Writes are grouped: one `UPDATE ... WHERE id IN (...)` per distinct new key, one
 * for everything being cleared, one INSERT for everything being added. However many
 * thousand rows an org holds, that is a handful of statements.
 *
 * ## 🛑 What it deliberately does NOT do, and what that costs
 *
 * `buildImportedExternalId` (`banking/import/match-key.ts`) embeds the match key in
 * the id it synthesises for a CSV row that arrived without one, so that re-importing
 * the same file UPDATES its rows instead of duplicating them. Recomputing the key
 * therefore changes what a re-import of an already-imported file would produce, and
 * those rows would land as duplicates rather than updates.
 *
 * This migration does not rewrite those ids. Rebuilding one means re-deriving the
 * per-(day, amount, payee) ordinal, and the stored ordinal came from position within
 * the FILE - an order the database only approximates. Guessing it wrong would
 * corrupt an identity that is unique across the org, which is worse than the
 * duplicate it would prevent, and the duplicate is visible: #2102's
 * `findDuplicateBankMovements` flags exactly this shape.
 *
 * It is a live question only if such rows exist. **They do not**: every
 * `bank_transaction` in the measured production feed is `source: 'feed'` with a
 * provider `fctxn_…` id, and the dev database holds none either. So the migration
 * COUNTS them and logs a warning naming the consequence rather than acting on a
 * case that has never occurred. If that count is ever non-zero, re-import of those
 * files is what needs looking at.
 *
 * ## Self-sufficient, but deliberately NOT a frozen copy
 *
 * Migration 143 keeps its own narrow decode on the principle that a migration must
 * still make sense years after the reader it might have shared has changed. This one
 * inverts that on purpose: its entire job is to bring stored keys into step with the
 * CURRENT normaliser, so it imports the live function. A frozen copy would put the
 * stored keys back out of step the next time a rule is added, which is the exact
 * debt it exists to pay off.
 */
export const migration147BackfillBankMatchKeys: PerOrgMigration = {
  id: '147-backfill-bank-match-keys',
  description:
    'Recomputes every stored bank_transaction.matchKey from its own description with the ' +
    'current normalizeMatchKey, so the rows ingested before the mixed-token and bare-check ' +
    'rules landed group the same way new ones do ' +
    '(plans/accounting/tasks/11-clearing-the-review-queue.md, LANDED follow-ups 1 and 2)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(BANK_TRANSACTION_ENTITY_TYPE)
    if (!def) return { ...state, alreadyUpToDate: true }

    const descriptionField = existing.fields.get(fieldKey(def.id, DESCRIPTION_ATTRIBUTE))
    const matchKeyField = existing.fields.get(fieldKey(def.id, MATCH_KEY_ATTRIBUTE))
    if (!descriptionField || !matchKeyField) return { ...state, alreadyUpToDate: true }

    const rows = await readKeyRows(db, organizationId, [descriptionField.id, matchKeyField.id])
    const plan = planRecompute(rows, descriptionField.id, matchKeyField.id)

    const outcome = await applyRecompute(db, organizationId, def.id, matchKeyField.id, plan)

    const externalIdField = existing.fields.get(fieldKey(def.id, EXTERNAL_ID_ATTRIBUTE))
    outcome.synthesisedExternalIds = externalIdField
      ? await countSynthesisedExternalIds(db, organizationId, externalIdField.id)
      : 0

    const touched = outcome.rewritten + outcome.inserted + outcome.cleared
    if (touched > 0) {
      logger.info('Migration 147 applied', { organizationId, ...outcome })
    }
    if (touched > 0 && outcome.synthesisedExternalIds > 0) {
      logger.warn(
        'Migration 147 left synthesised import external ids untouched - re-importing those ' +
          'files will duplicate rather than update their rows',
        { organizationId, synthesisedExternalIds: outcome.synthesisedExternalIds }
      )
    }

    return { ...state, alreadyUpToDate: touched === 0 }
  },
}

/** Every `description` and `matchKey` value in this org, in ONE round trip. */
export async function readKeyRows(
  db: Database,
  organizationId: string,
  fieldIds: string[]
): Promise<KeyRow[]> {
  return db
    .select({
      id: schema.FieldValue.id,
      fieldId: schema.FieldValue.fieldId,
      entityId: schema.FieldValue.entityId,
      valueText: schema.FieldValue.valueText,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
}

/** What {@link applyRecompute} has to write, decided in memory. */
export interface RecomputePlan {
  /** `new key -> FieldValue ids to set to it`. Grouped so one UPDATE serves many rows. */
  rewriteGroups: Map<string, string[]>
  /** `FieldValue` ids whose new key is empty, to NULL. */
  clearIds: string[]
  /** Instances with no `matchKey` row at all and a non-empty new key. */
  inserts: { entityId: string; matchKey: string }[]
  unchanged: number
}

/**
 * Decide every write from the already-fetched rows. Pure - no db, no clock.
 *
 * ⚠️ An instance with a `matchKey` row but NO `description` row is left alone rather
 * than cleared. `normalizeMatchKey(null)` is `''`, so treating a missing description
 * as "recompute to empty" would wipe the key off any row whose description the feed
 * has not delivered yet, and the queue would lose its grouping for them silently.
 */
export function planRecompute(
  rows: readonly KeyRow[],
  descriptionFieldId: string,
  matchKeyFieldId: string
): RecomputePlan {
  const descriptions = new Map<string, string | null>()
  const stored = new Map<string, KeyRow>()
  for (const row of rows) {
    if (row.fieldId === descriptionFieldId) descriptions.set(row.entityId, row.valueText)
    else if (row.fieldId === matchKeyFieldId) stored.set(row.entityId, row)
  }

  const rewriteGroups = new Map<string, string[]>()
  const clearIds: string[] = []
  const inserts: { entityId: string; matchKey: string }[] = []
  let unchanged = 0

  for (const [entityId, description] of descriptions) {
    const next = normalizeMatchKey(description)
    const current = stored.get(entityId)

    if (!current) {
      if (next) inserts.push({ entityId, matchKey: next })
      continue
    }
    // '' and null are the same answer - "no key" - so a stored '' is already clear.
    const currentValue = current.valueText ?? ''
    if (currentValue === next) {
      unchanged++
      continue
    }
    if (!next) {
      clearIds.push(current.id)
      continue
    }
    const group = rewriteGroups.get(next) ?? []
    group.push(current.id)
    rewriteGroups.set(next, group)
  }

  return { rewriteGroups, clearIds, inserts, unchanged }
}

/** Execute a {@link RecomputePlan}: one statement per distinct key, never per row. */
export async function applyRecompute(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  matchKeyFieldId: string,
  plan: RecomputePlan
): Promise<Outcome> {
  const now = new Date()
  let rewritten = 0

  for (const [matchKey, valueIds] of plan.rewriteGroups) {
    await db
      .update(schema.FieldValue)
      .set({ valueText: matchKey, updatedAt: now })
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.id, valueIds)
        )
      )
    rewritten += valueIds.length
  }

  if (plan.clearIds.length > 0) {
    await db
      .update(schema.FieldValue)
      .set({ valueText: null, updatedAt: now })
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          inArray(schema.FieldValue.id, plan.clearIds)
        )
      )
  }

  if (plan.inserts.length > 0) {
    await db.insert(schema.FieldValue).values(
      plan.inserts.map((row) => ({
        organizationId,
        entityId: row.entityId,
        entityDefinitionId,
        fieldId: matchKeyFieldId,
        sortKey: generateKeyBetween(null, null),
        valueText: row.matchKey,
        updatedAt: now,
      }))
    )
  }

  return {
    rewritten,
    inserted: plan.inserts.length,
    cleared: plan.clearIds.length,
    unchanged: plan.unchanged,
    synthesisedExternalIds: 0,
  }
}

/**
 * How many rows carry an external id this codebase synthesised from a match key.
 * Reported, never rewritten - see the docblock above for why.
 */
export async function countSynthesisedExternalIds(
  db: Database,
  organizationId: string,
  externalIdFieldId: string
): Promise<number> {
  const rows = await db
    .select({ id: schema.FieldValue.id })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, externalIdFieldId),
        like(schema.FieldValue.valueText, `${SYNTHESISED_EXTERNAL_ID_PREFIX}%`)
      )
    )
  return rows.length
}
