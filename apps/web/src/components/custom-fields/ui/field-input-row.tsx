// apps/web/src/components/custom-fields/ui/field-input-row.tsx
'use client'

import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { extractRelationshipData } from '@auxx/lib/field-values/client'
import type { ResourceField } from '@auxx/lib/resources/client'

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

  // Normalize value for FieldInputAdapter
  // - RELATIONSHIP: extract IDs from any format
  // - SELECT types: ensure string[]
  const normalizedValue =
    fieldType === 'RELATIONSHIP' ? extractRelationshipData(value).ids : value

  // Get relatedEntityDefinitionId for wrapping relationship IDs on save
  const relationshipConfig = field.options?.relationship
  const relatedEntityDefinitionId =
    relationshipConfig?.relatedEntityDefinitionId ?? relationshipConfig?.relatedModelType ?? null

  // Determine if relationship is multi-select
  const isMultiRelationship = relationshipConfig?.relationshipType === 'has_many'

  /**
   * Handle value changes from FieldInputAdapter
   * For relationships, wrap IDs with relatedEntityDefinitionId
   */
  const handleChange = (newValue: unknown) => {
    if (fieldType === 'RELATIONSHIP' && relatedEntityDefinitionId) {
      // Wrap IDs with relatedEntityDefinitionId for saving
      const ids = newValue as string[]
      const values = ids.map((id) => ({
        relatedEntityId: id,
        relatedEntityDefinitionId,
      }))
      onChange(field.id!, isMultiRelationship ? values : (values[0] ?? null))
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
