// packages/lib/src/resources/registry/resources/signature-fields.ts

import { FieldType } from '@auxx/database/enums'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../types'
import { CREATED_BY_FIELD } from '../common-fields'
import type { ResourceField } from '../field-types'

/**
 * Field definitions for the Signature resource.
 * These get seeded as CustomFields in the entity system.
 */
export const SIGNATURE_FIELDS: Record<string, ResourceField> = {
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
    nullable: false,
    operatorOverrides: ['is', 'is not', 'in', 'not in', 'exists', 'not exists'],
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Unique signature identifier',
  },

  name: {
    id: toFieldId('name'),
    key: 'name',
    label: 'Name',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'signature_name',
    systemSortOrder: 'a1',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
      required: true,
    },
    description: 'Signature name for identification',
  },

  body: {
    id: toFieldId('body'),
    key: 'body',
    label: 'Body',
    type: BaseType.STRING,
    fieldType: FieldType.RICH_TEXT,
    isSystem: true,
    systemAttribute: 'signature_body',
    systemSortOrder: 'a2',
    nullable: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
      required: true,
    },
    description: 'HTML content of the signature',
  },

  // `isDefault` (`signature_is_default`, sort `a3`) and `visibility`
  // (`signature_visibility`, `a4`) were removed by plan 36:
  //  - visibility is now `ResourceAccess` rows — `signature` is an
  //    `INSTANCE_ACCESS_RESOURCES` key with `baselineAtCreate: true`, so
  //    who-can-see-this lives in grants, not a decorative select (§0.3).
  //  - "default signature" became per-USER, stored in `UserSetting` under
  //    `signature.defaultId` (§12.2). An org-global default is incoherent once
  //    signatures are private by default — it can point at a signature most
  //    members cannot see.
  // Existing orgs are reconciled by entity migration
  // `057-remove-signature-visibility-field`. The sort-order gap is deliberate;
  // do not renumber, the remaining keys are stable.

  createdAt: {
    id: toFieldId('createdAt'),
    key: 'createdAt',
    label: 'Created At',
    type: BaseType.DATETIME,
    fieldType: FieldType.DATETIME,
    isSystem: true,
    systemAttribute: 'created_at',
    systemSortOrder: 'a5',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
    description: 'Automatically set when signature is created',
  },

  createdBy: CREATED_BY_FIELD,
}
