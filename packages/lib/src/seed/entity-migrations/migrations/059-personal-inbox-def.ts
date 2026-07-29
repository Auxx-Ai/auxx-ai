// packages/lib/src/seed/entity-migrations/migrations/059-personal-inbox-def.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { PERSONAL_INBOX_FIELDS } from '../../../resources/registry/resources/personal-inbox-fields'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  ensureCustomFields,
  ensureEntityDefinitions,
  linkDisplayFields,
  loadExistingState,
} from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:059')

/**
 * Migration 059: materialize the `personal_inbox` EntityDefinition and its seven
 * `CustomField` rows for every existing org (plan 40 §3.1, 40a §1.1/§1.2).
 *
 * A personal mailbox is today an ordinary `inbox` instance carrying an
 * `inbox_is_personal = true` FieldValue, defended by a write-wall pre-hook. Plan
 * 40 replaces that forgeable marker with def membership. This migration is the
 * first half — it creates the container. **Nothing moves here**: no instance
 * changes def, no read path consults the new def, and no `ResourceAccess` row is
 * re-keyed. Migration 060 performs the instance move, and it hard-depends on
 * this one having run (it needs the new def's `CustomField` ids to remap
 * FieldValues onto).
 *
 * Fresh orgs get the def and its fields for free through the normal
 * `EntitySeeder` path (`SYSTEM_ENTITIES` + `FIELD_REGISTRY`), which is why this
 * migration only has to catch up orgs seeded before plan 40.
 *
 * **Field set.** `PERSONAL_INBOX_FIELDS` mirrors `INBOX_FIELDS` minus
 * `inbox_default_lens` (a personal mailbox has no org-wide visibility floor) and
 * minus `inbox_is_personal` (the def IS the marker). `inbox_owner_user_id`
 * survives — offboarding, orphan detection and the Gmail-parity sync all need
 * it. The `systemAttribute` slugs are reused verbatim: `CustomField` rows are
 * scoped to an entity definition, so `inbox_name` on `personal_inbox` and
 * `inbox_name` on `inbox` are distinct rows and the `SystemAttribute` union
 * needs no new members.
 *
 * **Why the per-org backfill is mandatory, not cosmetic.** A registry field only
 * exists for an org once its `CustomField` row is materialized
 * (`project_registry_fields_need_materialization`): `FieldValue.fieldId` is a
 * real FK, so the first write against an unmaterialized field aborts. The org's
 * `resources`/`customFields` caches have to be rebuilt too or readers keep
 * serving a def with no fields — `runEntityMigrationForAllOrgs` does that
 * (`invalidateAndRecompute` per changed org over `entityDefs`/`entityDefSlugs`/
 * `customFields`/`resources`, plus a global flush), which is why this file does
 * no cache work of its own.
 *
 * **Orgs with an incomplete `inbox` field set.** Some orgs never received the
 * later `inbox_*` backfills and are missing e.g. `inbox_color`. That does not
 * leak into this migration: `ensureCustomFields` diffs against
 * `${entityDefinitionId}:${systemAttribute}` keys scoped to the NEW def, so every
 * org gets a complete seven regardless of the state of its `inbox` def.
 *
 * No views and no dashboards — `inbox` has none either (mail surfaces render
 * inboxes, not the record UI), so the new def needs none.
 *
 * Idempotent: a re-run finds the def and all seven fields already present,
 * creates nothing, and reports `alreadyUpToDate`.
 */
export const migration059PersonalInboxDef: EntityMigration = {
  id: '059-personal-inbox-def',
  description: 'Add personal_inbox as a system entity with its 7 CustomFields (plan 40 phase 1)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const entityDefIds = await ensureEntityDefinitions(
      db,
      organizationId,
      SYSTEM_ENTITIES.filter((e) => e.entityType === 'personal_inbox'),
      existing,
      state
    )

    const personalInboxDefId = entityDefIds.get('personal_inbox')
    if (!personalInboxDefId) {
      return { ...state, alreadyUpToDate: true }
    }

    const allFieldMaps = await ensureCustomFields(
      db,
      organizationId,
      'personal_inbox',
      personalInboxDefId,
      PERSONAL_INBOX_FIELDS,
      existing,
      state
    )

    await linkDisplayFields(db, ['personal_inbox'], entityDefIds, allFieldMaps)

    const alreadyUpToDate = state.entityDefsCreated === 0 && state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 059 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
