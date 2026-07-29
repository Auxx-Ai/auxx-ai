// packages/lib/src/seed/entity-migrations/migrations/062-remove-inbox-lens-personal-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:062')

/**
 * The two `INBOX_FIELDS` entries removed from the registry by plan 40 phase 4.
 *
 * Frozen as local string constants, the same discipline
 * `057-remove-signature-visibility-field.ts`'s `REMOVED_ATTRS` uses: the
 * registry no longer names them, and `CustomField.systemAttribute` is a plain
 * `text` column, so nothing needs the `SystemAttribute` union here.
 *
 * - `inbox_default_lens` — the org-wide visibility floor is a `role:org_member`
 *   `ResourceAccess` row now (`inboxes/inbox-floor.ts`, plan 40 §6). It stopped
 *   being READ in phase 2 and stopped being WRITTEN in §6; data migration 060
 *   projected every non-`full` floor onto a row before this runs.
 * - `inbox_is_personal` — personal-ness is membership of the `personal_inbox`
 *   EntityDefinition (40a §3). Data migration 060 moved every marked instance
 *   onto that def before this runs.
 */
const REMOVED_ATTRS = ['inbox_default_lens', 'inbox_is_personal'] as const

/**
 * The ledger id of the data migration that MUST have run first.
 *
 * Frozen as a literal rather than imported from `060-personal-inbox-move`: a
 * migration is a snapshot and must not break when a sibling is edited
 * (`feedback_migrations_self_sufficient`).
 */
const PREREQUISITE_MIGRATION_ID = '060-personal-inbox-move'

/** `EntityInstance.entityDefinitionId` values still marked personal, if any. */
export interface StrandedPersonalInbox {
  instanceId: string
  entityDefinitionId: string
}

/**
 * Remove the retired `inbox_default_lens` + `inbox_is_personal` `CustomField`
 * rows from an org's `inbox` definition, along with their `FieldValue` cells.
 *
 * The inverse of the `ensureCustomFields` add path: per
 * `project_registry_fields_need_materialization` a registry field only exists
 * for an org once it is materialized, so removing it from the registry is only
 * half the change — the per-org rows have to go too, or every form, filter and
 * builder keeps offering a field the registry no longer describes. Worse here
 * than for an ordinary field: the resource registry RETURNS unmatched DB rows
 * (`resource-registry-service.mergeSystemAndCustomFields`), so a left-behind row
 * shows up as a nameless custom field on the inbox record.
 *
 * Cache invalidation is the runner's job — `runEntityMigrationForAllOrgs`
 * recomputes `entityDefs` / `entityDefSlugs` / `customFields` / `resources` for
 * any org whose result is not `alreadyUpToDate`. Do not hand-roll it here.
 *
 * ## Ordering — why the guard is not decorative
 *
 * Both attributes are INPUTS to data migration `060-personal-inbox-move`, and
 * losing either before 060 runs fails **open**:
 *
 *  - `inbox_is_personal` is how 060 finds the instances to move. Delete it first
 *    and every personal mailbox stays on the shared def with nothing marking it
 *    — `derivePersonal` reports `false`, `composeUserMailVisibility` skips its
 *    personal branch, and the `Area.inboxes` fallback hands every org member
 *    `full` on somebody's private mail.
 *  - `inbox_default_lens` is the source 060 projects the `role:org_member`
 *    baseline rows FROM. Delete it first and every deliberately-restricted
 *    shared inbox loses its floor with no row to replace it, which the same
 *    fallback then reads as org-visible.
 *
 * `plan.ts` walks the shared NNN registry in id order with fail-stop, so
 * `060 < 062` holds by construction for the normal path — the guard is for the
 * abnormal ones: a hand-run migration, a `rerunDataMigration` that cleared a
 * `failed` 060, or a restored database whose ledger and data disagree. It
 * therefore checks BOTH the ledger row and the data invariant, because they fail
 * differently: a missing ledger row means 060 never ran (floors unprojected,
 * invisible in the data once you look only at instances), while a surviving
 * `inbox_is_personal = true` means 060 ran but did not finish its job.
 *
 * Idempotent — a re-run finds no matching `CustomField` rows and returns
 * `alreadyUpToDate`, doing no writes at all.
 */
export const migration062RemoveInboxLensPersonalFields: EntityMigration = {
  id: '062-remove-inbox-lens-personal-fields',
  description:
    'Remove the retired inbox_default_lens + inbox_is_personal system fields (floor is a ResourceAccess row, personal-ness is def membership)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const inboxDef = existing.entityDefs.get('inbox')
    if (!inboxDef) {
      return { ...state, alreadyUpToDate: true }
    }

    const fields = await db
      .select({ id: schema.CustomField.id, systemAttribute: schema.CustomField.systemAttribute })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.entityDefinitionId, inboxDef.id),
          inArray(schema.CustomField.systemAttribute, [...REMOVED_ATTRS])
        )
      )

    // Checked BEFORE the prerequisite guard so a re-run stays a pure no-op even
    // in an environment whose ledger was rebuilt: there is nothing left to
    // delete, so there is nothing left to get wrong.
    if (fields.length === 0) {
      return { ...state, alreadyUpToDate: true }
    }

    // ── Guard 1: the ledger. ─────────────────────────────────────────────────
    // The ledger is global (one row per migration id), not per-org, so this is
    // the same answer for every org in the fan-out — cheap, and it is the only
    // way to detect "060 never ran" for an org that happens to have no personal
    // inbox but does have restricted shared ones whose floors are unprojected.
    const [ledgerRow] = await db
      .select({ status: schema.DataMigration.status })
      .from(schema.DataMigration)
      .where(eq(schema.DataMigration.id, PREREQUISITE_MIGRATION_ID))
      .limit(1)

    if (ledgerRow?.status !== 'applied') {
      throw new Error(
        `${PREREQUISITE_MIGRATION_ID} has not been applied (ledger status: ${
          ledgerRow?.status ?? 'absent'
        }); it moves personal inboxes onto the personal_inbox def and projects inbox_default_lens onto role:org_member rows. Run it before 062, or every restricted inbox becomes org-visible.`
      )
    }

    // ── Guard 2: the data invariant. ─────────────────────────────────────────
    // An `applied` ledger row is not proof the work landed for THIS org (a
    // partial 060, a restored database, a hand-run). Any instance still carrying
    // `inbox_is_personal = true` is a personal mailbox 060 left on the shared
    // def; dropping the marker now is what would silently expose it.
    const personalFieldIds = fields
      .filter((f) => f.systemAttribute === 'inbox_is_personal')
      .map((f) => f.id)

    if (personalFieldIds.length > 0) {
      const stranded = await db
        .select({ entityId: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .where(
          and(
            inArray(schema.FieldValue.fieldId, personalFieldIds),
            eq(schema.FieldValue.valueBoolean, true)
          )
        )

      if (stranded.length > 0) {
        throw new Error(
          `${stranded.length} inbox instance(s) in organization ${organizationId} still carry inbox_is_personal = true, so ${PREREQUISITE_MIGRATION_ID} did not finish moving them onto the personal_inbox def. Refusing to drop the marker: these mailboxes would become org-visible. Instances: ${stranded
            .map((r) => r.entityId)
            .join(', ')}`
        )
      }
    }

    const fieldIds = fields.map((f) => f.id)

    const deletedValues = await db
      .delete(schema.FieldValue)
      .where(inArray(schema.FieldValue.fieldId, fieldIds))
      .returning({ id: schema.FieldValue.id })

    await db.delete(schema.CustomField).where(inArray(schema.CustomField.id, fieldIds))

    logger.info('Migration 062 applied', {
      organizationId,
      fieldsRemoved: fieldIds.length,
      attributes: fields.map((f) => f.systemAttribute),
      valuesRemoved: deletedValues.length,
    })

    return { ...state, alreadyUpToDate: false }
  },
}
