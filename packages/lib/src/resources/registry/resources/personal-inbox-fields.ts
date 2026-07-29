// packages/lib/src/resources/registry/resources/personal-inbox-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the `personal_inbox` resource — one user's connected
 * personal mailbox (plan 40 / 40a §1.2).
 *
 * A personal mailbox used to be an ordinary `inbox` EntityInstance carrying an
 * `inbox_is_personal = true` FieldValue behind a write-wall pre-hook. Plan 40
 * makes personal-ness unforgeable **def membership** instead, so this is a
 * separate EntityDefinition with its own materialized `CustomField` rows.
 *
 * **Relationship to `INBOX_FIELDS`.** Deliberately a standalone literal rather
 * than a derivation of `inbox-fields.ts`, because the two sets diverge in both
 * directions:
 *
 * - `inbox_default_lens` is NOT here — a personal mailbox has no org-wide
 *   visibility floor to configure (it is always effectively `none`; only the
 *   owner's own grant lets anyone in).
 * - `inbox_is_personal` is NOT here — the def IS the marker. Nothing to store,
 *   and nothing to forge.
 * - `inbox_owner_user_id` IS here, permanently. Offboarding/orphan detection,
 *   the Gmail-parity read-state sync and participant naming all need to know
 *   whose mailbox this is. Plan 40 phase 4 removes it from `INBOX_FIELDS` (a
 *   shared org inbox has no owner), which is exactly why deriving this set from
 *   `INBOX_FIELDS` by omission would be a silent trap: it would delete the field
 *   from here too.
 *
 * Everything else mirrors `INBOX_FIELDS` verbatim, **including the
 * `systemAttribute` slugs** — `CustomField` rows are scoped to an entity
 * definition (`ExistingState.fields` is keyed
 * `${entityDefinitionId}:${systemAttribute}`, `entity-migrations/helpers.ts`),
 * so `inbox_name` on `personal_inbox` and `inbox_name` on `inbox` are different
 * rows and no new `SystemAttribute` union members are needed. Reusing the slugs
 * is also what lets migration 060 remap a moved instance's FieldValues
 * attribute-for-attribute.
 *
 * `systemSortOrder` values are carried over unchanged so a personal inbox
 * renders its fields in the same order as a shared one (the `a5a`/`a5b` gaps are
 * the two omitted fields).
 *
 * Nine entries, of which **seven materialize** as `CustomField` rows: `id` and
 * `createdAt` are `EntityInstance` columns and are skipped by
 * `shouldCreateField` (`ENTITY_INSTANCE_COLUMNS`), exactly as on `inbox`. They
 * are listed anyway so filtering/sorting metadata is complete for the registry.
 */
export const PERSONAL_INBOX_FIELDS: Record<string, ResourceField> = {
  id: {
    id: toFieldId('id'),
    key: 'id',
    label: 'ID',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'id',
    systemSortOrder: 'a0',
    showInPanel: false,
    dbColumn: 'id',
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique personal inbox identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'inbox_name',
    systemSortOrder: 'a1',
    dbColumn: 'name',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Personal inbox name',
  },

  description: {
    id: toFieldId('description'),
    key: 'description',
    label: 'Description',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'inbox_description',
    systemSortOrder: 'a2',
    nullable: true,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Personal inbox description',
  },

  color: {
    id: toFieldId('color'),
    key: 'color',
    label: 'Color',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'inbox_color',
    systemSortOrder: 'a3',
    nullable: true,
    defaultValue: 'indigo',
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Personal inbox color for UI display',
  },

  status: {
    id: toFieldId('status'),
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: FieldType.SINGLE_SELECT,
    isSystem: true,
    systemAttribute: 'inbox_status',
    systemSortOrder: 'a4',
    nullable: false,
    defaultValue: 'ACTIVE',
    options: {
      options: [
        { value: 'ACTIVE', label: 'Active', color: 'green' },
        // `amber`, not `inbox`'s `yellow` — the latter is not in the option-colour
        // union and is a live (pre-existing) tsc error in `inbox-fields.ts`. Fixing
        // it there is a separate change; this file starts clean.
        { value: 'PAUSED', label: 'Paused', color: 'amber' },
        { value: 'ARCHIVED', label: 'Archived', color: 'gray' },
      ],
    },
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Personal inbox status',
  },

  ownerUserId: {
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
      'User id of the mailbox owner (mail-permissions §11). Set by the personal connect flow; an admin claim moves the instance onto the shared `inbox` def and clears it.',
  },

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a6',
    dbColumn: 'createdAt',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when the personal inbox is created',
  },

  settings: {
    id: toFieldId('settings'),
    key: 'settings',
    label: 'Settings',
    type: BaseType.JSON,
    fieldType: FieldType.JSON,
    isSystem: true,
    systemAttribute: 'inbox_settings',
    systemSortOrder: 'a7',
    nullable: true,
    showInPanel: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    description: 'Personal inbox configuration settings stored as JSON',
  },

  createdBy: CREATED_BY_FIELD,
}
