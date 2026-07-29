// packages/lib/src/seed/entity-migrations/migrations/026-inbox-personal-fields.ts

import type { Database } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { toFieldId } from '@auxx/types/field'
import type { ResourceField } from '../../../resources/registry/field-types'
import { BaseType } from '../../../resources/types'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:026')

/**
 * The two `INBOX_FIELDS` entries this migration materializes, frozen as local
 * copies — kept in sync by hand, because plan 40 phase 4 deletes the registry
 * originals. `inbox_is_personal` is replaced by membership of the
 * `personal_inbox` EntityDefinition (059/060), and `inbox_owner_user_id` moves
 * to `PERSONAL_INBOX_FIELDS` — a shared org inbox has no owner.
 *
 * The repo has frozen retired field IDENTIFIERS before
 * (`057-remove-signature-visibility-field.ts`'s `REMOVED_ATTRS`); this is the
 * first frozen field SPEC. Note that
 * `021-signature-fields-prefix.ts` handled the same compile pressure by *editing
 * history* — it simply dropped the retired fields from the migration. **That
 * does not transfer here.** Migration 060 reads `inbox_is_personal` to decide
 * which instances to move, so an org sitting between 026 and 060 must still have
 * these two `CustomField` rows materialized. Editing them out of 026 would leave
 * such an org with no marker for 060 to find, and no FK-valid field to have
 * written it to in the first place.
 *
 * Copied verbatim from `resources/registry/resources/inbox-fields.ts` at the
 * time of writing; a migration is a snapshot and must not drift when the
 * registry changes (`feedback_migrations_self_sufficient`).
 */
const FROZEN_IS_PERSONAL_FIELD = {
  id: toFieldId('isPersonal'),
  key: 'isPersonal',
  label: 'Personal',
  type: BaseType.BOOLEAN,
  fieldType: FieldType.CHECKBOX,
  isSystem: true,
  systemAttribute: 'inbox_is_personal',
  systemSortOrder: 'a5b',
  nullable: false,
  defaultValue: false,
  showInPanel: false,
  capabilities: {
    filterable: true,
    sortable: false,
    creatable: true,
    updatable: true,
    configurable: false,
  },
  description:
    'Personal-account inbox (mail-permissions §11): owned by one user, admins capped at activity-only, invisible to automation. Set by the personal connect flow; cleared by an admin claim.',
} satisfies ResourceField

/** @see FROZEN_IS_PERSONAL_FIELD — same freeze, same reason. */
const FROZEN_OWNER_USER_ID_FIELD = {
  id: toFieldId('ownerUserId'),
  key: 'ownerUserId',
  label: 'Owner',
  type: BaseType.STRING,
  fieldType: FieldType.TEXT,
  isSystem: true,
  systemAttribute: 'inbox_owner_user_id',
  systemSortOrder: 'a5c',
  nullable: true,
  showInPanel: false,
  capabilities: {
    filterable: true,
    sortable: false,
    creatable: true,
    updatable: true,
    configurable: false,
  },
  description:
    'User id of the personal-inbox owner (mail-permissions §11). Null on shared org inboxes.',
} satisfies ResourceField

/**
 * Migration 026: Add the personal-account fields to the inbox entity
 * (mail-permissions §11): `inbox_is_personal` marks an inbox as one user's
 * connected personal mailbox (admins capped at activity-only, invisible to
 * automation) and `inbox_owner_user_id` records who owns it. New orgs get
 * both from `createAllFields`; this backfills the `CustomField` rows for
 * existing orgs. No data migration needed — no personal inboxes exist yet.
 */
export const migration026InboxPersonalFields: EntityMigration = {
  id: '026-inbox-personal-fields',
  description: 'Add inbox_is_personal + inbox_owner_user_id system fields (personal accounts §11)',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const inboxDef = existing.entityDefs.get('inbox')
    if (!inboxDef) {
      logger.warn('No inbox entity found, skipping personal fields', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'inbox',
      inboxDef.id,
      {
        isPersonal: FROZEN_IS_PERSONAL_FIELD,
        ownerUserId: FROZEN_OWNER_USER_ID_FIELD,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 026 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate }
  },
}
