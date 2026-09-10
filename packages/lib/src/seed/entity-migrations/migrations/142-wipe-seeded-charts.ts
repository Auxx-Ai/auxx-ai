// packages/lib/src/seed/entity-migrations/migrations/142-wipe-seeded-charts.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import { deleteEntityInstances } from '../../../entity-instances'
import type { SettingKey } from '../../../settings/catalog'
import { batchUpdateOrganizationSettings } from '../../../settings/settings-service'
import type { SettingValue } from '../../../settings/types'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:142')

/**
 * Frozen as local string literals rather than imported from the registry or
 * `entity-seeder/constants.ts`: the same discipline `057`, `062` and `114`
 * use. This migration is a one-time snapshot of what 108/125/126/133/136 wrote;
 * it must not break when a sibling constant is renamed later.
 */
const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'
const JOURNAL_ENTRY_ENTITY_TYPE = 'journal_entry'

/**
 * The QuickBooks account-map identity, frozen rather than imported from
 * `money/quickbooks/account-map.ts` / `identity-field.ts` for the same reason
 * as the entity types above: see `QBO_ACCOUNT_ID_FIELD` and
 * `QUICKBOOKS_SOURCE` there.
 */
const QBO_ACCOUNT_ID_FIELD = 'qboAccountId'
const QUICKBOOKS_SOURCE = 'quickbooks'

/**
 * Every wizard-written `accounting.*` / `ledger.*` setting this migration
 * resets to its catalog default, with that default given explicitly
 * (`settings/catalog.ts` ~860-1140). Deliberately EXCLUDES
 * `accounting.bookTimeZone`, `accounting.fulfillmentPosting` and
 * `accounting.paymentRoute.*`: those are configuration a person may have set
 * independently of the wizard's opening-baseline flow, not wizard state, and
 * 17 §1 names them by exception.
 */
export const SETTINGS_TO_RESET: readonly { key: SettingKey; value: SettingValue }[] = [
  { key: 'accounting.setupState', value: 'draft' },
  { key: 'accounting.cutoffPeriod', value: null },
  { key: 'accounting.setupFinalizedAt', value: null },
  { key: 'accounting.setupFinalizedByUserId', value: null },
  { key: 'accounting.openingRawMaterials', value: null },
  { key: 'accounting.openingWip', value: null },
  { key: 'accounting.openingFinishedGoods', value: null },
  { key: 'accounting.qboOpeningRawMaterials', value: null },
  { key: 'accounting.qboOpeningWip', value: null },
  { key: 'accounting.qboOpeningFinishedGoods', value: null },
  { key: 'accounting.qboOpeningJournalRef', value: null },
  { key: 'ledger.lockedThroughMonth', value: null },
]

/** The per-org cache keys this migration's writes invalidate. */
const CACHE_KEYS = ['customFields', 'resources', 'orgSettings'] as const

/**
 * Migration 142: wipe every seeded chart of accounts, its role assignments and
 * the wizard's setup state, in every org (plans/accounting/tasks/17-accounting-is-opt-in.md
 * §1, HANDOFF §25.6).
 *
 * ## Why
 *
 * Entity migrations 108, 125, 126, 133 and 136 seeded a 38-account chart and
 * thirty `GlRoleAssignment` rows into every org that existed when they ran, in
 * a module `FeatureKey.accounting` gates off for every org but one. The premise
 * that the chart is "seeded on org creation" is false: `createOrganization`
 * never touches it, and the wizard's Provision chart button
 * (`ledger.provisionChart`) is the only door onto a chart for a new org. This
 * migration deletes what those five migrations wrote so an org reads as never
 * having opened the wizard, and stops there; it does NOT re-seed anything.
 * 17 §2 makes the five call sites permanently inert so a fresh database never
 * writes this again.
 *
 * ## What it deletes, and what it deliberately does NOT touch
 *
 * - `GlRoleAssignment` rows for the org.
 * - The `gl_account` `EntityInstance`s and their `FieldValue`s, through
 *   {@link deleteEntityInstances} (which also sweeps `TimelineEvent` and
 *   `ResourceAccess` rows addressed at them: a hand-rolled `FieldValue`-only
 *   delete would leave those orphaned).
 * - The `journal_entry` `EntityInstance`s and their `FieldValue`s (drafts,
 *   opening-balance holders, recurring stencils), the same way. Journal entry
 *   lines are a JSON field on the record (`journal-entry-fields.ts`), not a
 *   child entity, so there is no second def to touch.
 * - `RecordIdentity` rows carrying the QuickBooks account map
 *   (`source: 'quickbooks'`, `appFieldKey: 'qboAccountId'`): the map cannot
 *   outlive the accounts it maps. Belt and braces: `RecordIdentity.entityInstanceId`
 *   already cascades off `EntityInstance`, so the explicit delete below is
 *   redundant with that FK today, but it is what makes the migration correct
 *   even if that FK is ever loosened.
 * - The wizard-written `accounting.*` / `ledger.*` settings in
 *   {@link SETTINGS_TO_RESET}, back to their catalog defaults.
 * - The `customFields`, `resources` and `orgSettings` org-cache keys.
 *
 * 🛑 **`GlPosting` / `GlPostingLine` are NOT touched here.** A parallel change
 * adds a NOT NULL `glAccountId` column to `GlPostingLine` via a Drizzle
 * migration that itself deletes every row in both tables so the column can
 * land with no backfill (HANDOFF §25's step-1 ordering: this migration, then
 * 17 §2, then 15 §2). Deleting them here too would race that migration for no
 * reason: one door, one owner.
 *
 * 🛑 **`gl_account`'s entity DEFINITION is not touched**, only its rows: the
 * same distinction migration 114 draws for `gl_posting` / `gl_posting_line`.
 * The def stays in `SYSTEM_ENTITIES` with `isVisible: false`; Provision chart
 * still resolves it and writes fresh rows.
 *
 * 🛑 **Fails closed on a referencing `FieldValue`.** No field in the registry
 * declares a relationship onto `gl_account` or `journal_entry` today (verified
 * 2026-09-09 the same way `reset-gl-chart.ts` verifies it), so this is expected
 * to find nothing, but a chart row or journal entry that something else
 * points AT is exactly the case where a silent delete would quietly drop
 * another live record's relationship rather than merely deleting rows this
 * migration owns.
 *
 * ## Idempotent
 *
 * A second run over an org that has already been wiped finds zero chart
 * instances, zero journal entries, zero role assignments and every setting
 * already at its target value (an absent `OrganizationSetting` row reads as
 * the catalog default, which for the twelve keys in {@link SETTINGS_TO_RESET}
 * IS the reset target), so it reports `alreadyUpToDate` and deletes nothing.
 * It does NOT protect a chart provisioned by the wizard AFTER the first wipe:
 * this migration is recorded `applied` in the `DataMigration` ledger and the
 * normal deploy path never calls it again, but a super-admin re-running
 * migrations by hand (`admin.runAllEntityMigrations`) would wipe a real chart
 * a second time. That is the "lands first, and only once" warning 17 §1 opens
 * with, not a bug in this file.
 */
export const migration142WipeSeededCharts: EntityMigration = {
  id: '142-wipe-seeded-charts',
  description:
    'Wipes the chart of accounts, GlRoleAssignment rows, journal entries, the QuickBooks ' +
    'account map and the wizard setup settings that entity migrations 108/125/126/133/136 ' +
    'seeded into every org; accounting is opt-in, and Provision chart is the only way back ' +
    '(plans/accounting/tasks/17-accounting-is-opt-in.md §1)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const existing = await loadExistingState(db, organizationId)
    const glAccountDef = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
    const journalEntryDef = existing.entityDefs.get(JOURNAL_ENTRY_ENTITY_TYPE)

    const glAccountIds = glAccountDef
      ? await instanceIdsForDef(db, organizationId, glAccountDef.id)
      : []
    const journalEntryIds = journalEntryDef
      ? await instanceIdsForDef(db, organizationId, journalEntryDef.id)
      : []
    const allInstanceIds = [...glAccountIds, ...journalEntryIds]

    const roleAssignmentIds = await db
      .select({ id: schema.GlRoleAssignment.id })
      .from(schema.GlRoleAssignment)
      .where(eq(schema.GlRoleAssignment.organizationId, organizationId))

    const settingsToWrite = await settingsNeedingReset(db, organizationId)

    const hasWork =
      allInstanceIds.length > 0 || roleAssignmentIds.length > 0 || settingsToWrite.length > 0

    if (!hasWork) {
      return { ...state, alreadyUpToDate: true }
    }

    // ── The guard. Fails CLOSED on anything that points AT a chart row or a
    // journal entry. Checked per organization rather than trusted; see the
    // docblock above. ────────────────────────────────────────────────────
    if (allInstanceIds.length > 0) {
      const referencing = await db
        .select({ id: schema.FieldValue.id, fieldId: schema.FieldValue.fieldId })
        .from(schema.FieldValue)
        .where(inArray(schema.FieldValue.relatedEntityId, allInstanceIds))
        .limit(5)

      if (referencing.length > 0) {
        throw new Error(
          `Organization ${organizationId} has ${referencing.length}+ FieldValue row(s) pointing ` +
            'at a gl_account or journal_entry instance; refusing to wipe. No registry field is ' +
            'expected to relate to either (verified 2026-09-09). Repoint or clear these values ' +
            `first. Fields: ${referencing.map((r) => r.fieldId).join(', ')}`
        )
      }
    }

    // ── The QuickBooks account map. Belt and braces alongside the FK cascade
    // off EntityInstance; see the docblock above. ──────────────────────────
    if (glAccountIds.length > 0) {
      await db
        .delete(schema.RecordIdentity)
        .where(
          and(
            eq(schema.RecordIdentity.organizationId, organizationId),
            eq(schema.RecordIdentity.source, QUICKBOOKS_SOURCE),
            eq(schema.RecordIdentity.appFieldKey, QBO_ACCOUNT_ID_FIELD)
          )
        )
    }

    // ── The chart and the journal entries, FieldValue and TimelineEvent swept
    // with them. ─────────────────────────────────────────────────────────────
    if (allInstanceIds.length > 0) {
      const result = await deleteEntityInstances({ ids: allInstanceIds, organizationId, db })
      if (result.isErr()) {
        throw result.error
      }
    }

    // ── The role assignments. No FK to `gl_account` (deliberately: see the
    // table's own header), so this is independent of the delete above. ──────
    if (roleAssignmentIds.length > 0) {
      await db
        .delete(schema.GlRoleAssignment)
        .where(eq(schema.GlRoleAssignment.organizationId, organizationId))
    }

    // ── The wizard's setup state, back to the catalog default. ─────────────
    if (settingsToWrite.length > 0) {
      await batchUpdateOrganizationSettings({ organizationId, settings: settingsToWrite, db })
    }

    // A wiped chart, cleared settings and a dropped account map are all
    // invisible to every read path until the org caches serving them are
    // dropped. `runEntityMigrationForAllOrgs` does this after every org whose
    // result is not `alreadyUpToDate`, but `up()` can also be invoked
    // directly, so it clears its own.
    await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])

    logger.info('Migration 142 applied', {
      organizationId,
      glAccountsRemoved: glAccountIds.length,
      journalEntriesRemoved: journalEntryIds.length,
      roleAssignmentsRemoved: roleAssignmentIds.length,
      settingsReset: settingsToWrite.length,
    })

    return { ...state, alreadyUpToDate: false }
  },
}

/** Every `EntityInstance` id under one entity definition, in this org. */
export async function instanceIdsForDef(
  db: Database,
  organizationId: string,
  entityDefinitionId: string
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
  return rows.map((row) => row.id)
}

/**
 * The subset of {@link SETTINGS_TO_RESET} whose STORED value differs from the
 * reset target. An absent row reads as the catalog default, which for every
 * key here already equals the reset target, so a never-touched org (or an
 * already-wiped one) contributes nothing and the migration can report
 * `alreadyUpToDate`.
 */
export async function settingsNeedingReset(
  db: Database,
  organizationId: string
): Promise<{ key: SettingKey; value: SettingValue }[]> {
  const rows = await db
    .select({ key: schema.OrganizationSetting.key, value: schema.OrganizationSetting.value })
    .from(schema.OrganizationSetting)
    .where(
      and(
        eq(schema.OrganizationSetting.organizationId, organizationId),
        inArray(
          schema.OrganizationSetting.key,
          SETTINGS_TO_RESET.map((setting) => setting.key)
        )
      )
    )

  const stored = new Map(rows.map((row) => [row.key, row.value]))

  return SETTINGS_TO_RESET.filter((setting) => {
    if (!stored.has(setting.key)) return false
    return JSON.stringify(stored.get(setting.key) ?? null) !== JSON.stringify(setting.value)
  })
}
