// apps/web/src/components/workflow/nodes/core/crud/custom-fields.ts
import { type ResourceField, mapFieldTypeToBaseType } from '@auxx/lib/workflow-engine/client'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import { type FieldType } from '@auxx/database/types'

/**
 * Custom field information interface
 */
export interface CustomFieldInfo {
  id: string
  name: string
  type: FieldType
  required: boolean
  options?: any
}
/**
 * Convert custom field to ResourceField format (from CustomFieldInfo)
 */
export function convertCustomFieldToCrudField(customField: CustomFieldInfo): ResourceField {
  const baseType = mapFieldTypeToBaseType(customField.type)
  return {
    key: `custom_${customField.id}`,
    label: customField.name,
    type: baseType,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: true,
      updatable: true,
      required: customField.required || false,
    },
    placeholder: `Enter ${customField.name.toLowerCase()}`,
    description: `Custom field: ${customField.name}`,
    // Add enum values if single/multi select
    ...(customField.type === FieldTypeEnum.SINGLE_SELECT && {
      enumValues:
        customField.options?.options?.map((opt: any) => ({
          dbValue: opt.value,
          label: opt.value,
        })) || [],
    }),
  }
}

/**
 * Convert raw API custom field (from database/customField.getAll) to ResourceField format
 * Handles the database schema format returned by customField.getAll
 * @param apiField - Raw field from customField.getAll
 * @param options - Optional configuration for field capabilities
 * @returns ResourceField suitable for CRUD panel rendering
 */
export function convertApiCustomFieldToResourceField(
  apiField: any,
  options?: { filterable?: boolean }
): ResourceField {
  const baseType = mapFieldTypeToBaseType(apiField.type)

  return {
    key: `custom_${apiField.id}`,
    label: apiField.name,
    type: baseType,
    capabilities: {
      filterable: options?.filterable ?? false,
      sortable: false,
      creatable: true,
      updatable: true,
      required: apiField.required || false,
    },
    placeholder: `Enter ${apiField.name.toLowerCase()}`,
    description: apiField.description || `Custom field: ${apiField.name}`,
    // Handle enum values for select fields
    ...(apiField.type === FieldTypeEnum.SINGLE_SELECT && {
      enumValues:
        apiField.options?.options?.map((opt: any) => ({
          dbValue: opt.value,
          label: opt.label || opt.value,
        })) || [],
    }),
    ...(apiField.type === FieldTypeEnum.MULTI_SELECT && {
      enumValues:
        apiField.options?.options?.map((opt: any) => ({
          dbValue: opt.value,
          label: opt.label || opt.value,
        })) || [],
    }),
  }
}
