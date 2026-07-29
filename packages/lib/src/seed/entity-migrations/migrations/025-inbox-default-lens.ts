// packages/lib/src/seed/entity-migrations/migrations/025-inbox-default-lens.ts

import type { Database } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId } from '@auxx/types/field'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BaseType } from '../../../resources/types'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:025')

/**
 * The `INBOX_FIELDS.defaultLens` entry this migration materializes, frozen as a
 * local copy — kept in sync by hand, because plan 40 phase 4 deleted the
 * registry original. The org-wide floor is a `role:org_member` `ResourceAccess`
 * row now (`inboxes/inbox-floor.ts`, plan 40 §6).
 *
 * Same freeze, same reason as `026-inbox-personal-fields.ts`'s
 * `FROZEN_IS_PERSONAL_FIELD`: **editing this migration's history is not an
 * option.** Data migration `033-inbox-visibility-to-default-lens` writes
 * `inbox_default_lens` FieldValues and throws by name if the `CustomField` row
 * is missing (`033`: "run entity migration 025 first"), and `060` reads those
 * values to project the floors onto rows. An org sitting between 025 and 060
 * must still get this row materialized, or 033 fails outright and 060 has no
 * floors to project — which fails OPEN, turning every restricted shared inbox
 * org-visible. Entity migration 062 is what finally removes the row, and only
 * after 060 has run.
 *
 * Copied verbatim from `resources/registry/resources/inbox-fields.ts` as it
 * stood before the phase-4 deletion; a migration is a snapshot and must not
 * drift when the registry changes (`feedback_migrations_self_sufficient`).
 */
const FROZEN_DEFAULT_LENS_FIELD = {
  id: toFieldId('defaultLens'),
  key: 'defaultLens',
  label: 'Default Access',
  type: BaseType.ENUM,
  fieldType: FieldType.SINGLE_SELECT,
  isSystem: true,
  systemAttribute: 'inbox_default_lens',
  systemSortOrder: 'a5a',
  nullable: false,
  defaultValue: 'full',
  options: {
    options: [
      { value: 'none', label: 'No access' },
      { value: 'metadata', label: 'Activity only' },
      { value: 'subject', label: 'Subject only' },
      { value: 'full', label: 'Full access' },
    ],
  },
  capabilities: {
    filterable: true,
    sortable: false,
    creatable: true,
    updatable: true,
    configurable: false,
  },
  description:
    'Org-wide visibility floor: the lens every org member gets on this inbox. Explicit grants can only raise it (mail-permissions §2.2).',
} satisfies ResourceField

/**
 * Migration 025: Add the `inbox_default_lens` system field to the inbox entity.
 *
 * The org-wide visibility floor of the mail-permissions plan (§2.2): every org
 * member sees the inbox's threads at this lens; explicit ResourceAccess grants
 * can only raise it. New orgs get the field from `createAllFields`; this
 * backfills the `CustomField` row for existing orgs. Data migration
 * `033-inbox-visibility-to-default-lens` (which sorts after this one) converts
 * each inbox's legacy `inbox_visibility` value into a default-lens FieldValue.
 */
export const migration025InboxDefaultLens: EntityMigration = {
  id: '025-inbox-default-lens',
  description: 'Add inbox_default_lens system field (mail-permissions visibility floor) to inbox',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const inboxDef = existing.entityDefs.get('inbox')
    if (!inboxDef) {
      logger.warn('No inbox entity found, skipping default-lens field', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'inbox',
      inboxDef.id,
      { defaultLens: FROZEN_DEFAULT_LENS_FIELD },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 025 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate }
  },
}
