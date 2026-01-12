// apps/web/src/components/custom-fields/ui/field-input-row.tsx
'use client'

import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { extractRelationshipData, isMultiRelationship } from '@auxx/lib/field-values/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import type { ResourceRef } from '@auxx/types/resource'

/**
 * Props for FieldInputRow
 */
interface FieldInputRowProps {
  /** Resource field definition */
  field: ResourceField
  /** Current value */
  value: unknown
  /** Change handler */
  onChange: (fieldId: string, value: unknown) => void
  /** Validation error message */
  validationError?: string
  /** Whether validation has errors vs warnings */
  validationType?: 'error' | 'warning'
  /** Disable editing */
  disabled?: boolean
  /** Custom placeholder text (e.g., "<Varies>" for bulk edit) */
  placeholder?: string
}

/**
 * Renders a single field input row with VarEditorFieldRow layout.
 * Uses FieldInputAdapter which handles all field types including relationships.
 */
export function FieldInputRow({
  field,
  value,
  onChange,
  validationError,
  validationType = 'error',
  disabled = false,
  placeholder,
}: FieldInputRowProps) {
  const isRequired = field.required ?? field.capabilities?.required ?? false
  const fieldType = field.fieldType ?? 'TEXT'
  const relationshipConfig = field.options?.relationship

  // For RELATIONSHIP: pass ResourceRef[] directly to FieldInputAdapter
  // FieldInputAdapter will pass it through to MultiRelationInput (no double conversion)
  const normalizedValue =
    fieldType === 'RELATIONSHIP' ? extractRelationshipData(value).references : value

  // Get relatedEntityDefinitionId for wrapping ResourceRef[] back to RelationshipFieldValue on save
  const relatedEntityDefinitionId =
    relationshipConfig?.relatedEntityDefinitionId ?? relationshipConfig?.relatedModelType ?? null

  // Determine if relationship is multi-select using helper
  const isMulti = isMultiRelationship(relationshipConfig?.relationshipType)

  /**
   * Handle value changes from FieldInputAdapter
   * For relationships: convert ResourceRef[] back to RelationshipFieldValue[] for saving
   */
  const handleChange = (newValue: unknown) => {
    if (fieldType === 'RELATIONSHIP' && relatedEntityDefinitionId) {
      // Convert ResourceRef[] back to RelationshipFieldValue[] for saving
      const refs = newValue as ResourceRef[]
      const values = refs.map((ref) => ({
        relatedEntityId: ref.entityInstanceId,
        relatedEntityDefinitionId: ref.entityDefinitionId,
      }))
      onChange(field.id!, isMulti ? values : (values[0] ?? null))
    } else {
      onChange(field.id!, newValue)
    }
  }

  return (
    <VarEditorFieldRow
      title={field.label}
      description={field.description}
      type={field.type}
      isRequired={isRequired}
      validationError={validationError}
      validationType={validationType}
      showIcon>
      <FieldInputAdapter
        fieldType={fieldType}
        fieldOptions={field.options}
        value={normalizedValue}
        onChange={handleChange}
        placeholder={placeholder ?? `Enter ${field.label.toLowerCase()}...`}
        disabled={disabled}
      />
    </VarEditorFieldRow>
  )
}
