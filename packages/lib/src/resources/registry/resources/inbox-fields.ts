// packages/lib/src/resources/registry/resources/inbox-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Inbox resource
 * Defines all fields, their types, capabilities, and validation rules
 */
export const INBOX_FIELDS: Record<string, ResourceField> = {
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
    operatorOverrides: ['is', 'is not', 'in', 'not in'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique inbox identifier',
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
    description: 'Inbox name',
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
    description: 'Inbox description',
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
    description: 'Inbox color for UI display',
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
        // `amber`, not `yellow` — the latter is not in the option-colour union
        // (`packages/types/custom-field`), so it was a live tsc error here while
        // `personal-inbox-fields.ts` already carried the correct value.
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
    description: 'Inbox status',
  },

  // ── RETIRED by plan 40 phase 4 — entity migration 062 drops the rows ───────
  //
  // `defaultLens` (`inbox_default_lens`, sortOrder `a5a`) and `isPersonal`
  // (`inbox_is_personal`, `a5b`) used to sit here. The two `systemSortOrder`
  // gaps are left unfilled deliberately, mirroring `PERSONAL_INBOX_FIELDS`, so
  // the surviving fields keep their positions and nothing re-sorts.
  //
  //  - The org-wide floor is a `role:org_member` `ResourceAccess` row now
  //    (`inboxes/inbox-floor.ts`, plan 40 §6). It stopped being read in phase 2,
  //    which made writing the field a silent no-op; §6 moved the WRITE too.
  //    `Inbox.defaultLens` / `InboxItem.defaultLens` still exist and are still
  //    the floor — they are derived FROM THE ROWS, not from this field.
  //  - Personal-ness is membership of the `personal_inbox` EntityDefinition
  //    (40a §3). A def cannot be flipped by a field write, which is the whole
  //    point: the marker was forgeable through the generic records path and
  //    needed `guardInboxPersonalFields` to stand in front of it.
  //
  // `inbox_owner_user_id` deliberately SURVIVES on both defs — see below.
  //
  // Historical migrations 025 and 026 carry FROZEN local copies of these two
  // specs; they must keep materializing the fields for an org that has not
  // reached 060/062 yet. Do not "clean them up".
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
      'User id of the personal-inbox owner (mail-permissions §11). Null on shared org inboxes.',
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
    description: 'Automatically set when inbox is created',
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
    description: 'Inbox configuration settings stored as JSON',
  },

  createdBy: CREATED_BY_FIELD,
}
