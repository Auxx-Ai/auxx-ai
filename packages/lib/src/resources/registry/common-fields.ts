// packages/lib/src/resources/registry/common-fields.ts

import { FieldType } from '@auxx/database/enums'
import { CREATED_BY_FIELD_CONFIG } from '@auxx/types/custom-field'
import { toFieldId } from '@auxx/types/field'
import { BaseType } from '../../workflow-engine/core/types'
import type { ResourceField } from './field-types'

/**
 * Created By field - shared across all entity types
 * Shows which user created the record
 */
export const CREATED_BY_FIELD: ResourceField = {
  id: toFieldId('createdBy'),
  key: 'createdBy',
  label: CREATED_BY_FIELD_CONFIG.name,
  type: BaseType.ACTOR,
  fieldType: FieldType.ACTOR,
  isSystem: true,
  systemAttribute: CREATED_BY_FIELD_CONFIG.systemAttribute,
  systemSortOrder: 'az',
  dbColumn: CREATED_BY_FIELD_CONFIG.dbColumn,
  nullable: true,
  capabilities: {
    filterable: true,
    sortable: false,
    creatable: false,
    updatable: false,
    configurable: false,
  },
  options: {
    actor: CREATED_BY_FIELD_CONFIG.actorOptions,
  },
}
