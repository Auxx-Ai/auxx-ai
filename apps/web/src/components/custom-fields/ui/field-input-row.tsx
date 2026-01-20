// apps/web/src/components/custom-fields/ui/field-input-row.tsx
'use client'

import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import {
  extractRelationshipRecordIds,
  isMultiRelationship,
  type RecordId,
} from '@auxx/lib/field-values/client'
import { type RelationshipConfig } from '@auxx/types/custom-field'
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
  const relationshipConfig = field.options?.relationship as RelationshipConfig | undefined

  // For RELATIONSHIP: pass RecordId[] directly to FieldInputAdapter
  // FieldInputAdapter will pass it through to MultiRelationInput (no double conversion)
  const normalizedValue = fieldType === 'RELATIONSHIP' ? extractRelationshipRecordIds(value) : value

  // Determine if relationship is multi-select using helper
  const isMulti = isMultiRelationship(relationshipConfig?.relationshipType)

  /**
   * Handle value changes from FieldInputAdapter
   * For relationships: pass RecordId[] directly (converter handles wrapping)
   */
  const handleChange = (newValue: unknown) => {
    if (fieldType === 'RELATIONSHIP') {
      // Pass RecordId[] directly - converter handles wrapping
      const recordIds = newValue as RecordId[]
      onChange(field.id!, isMulti ? recordIds : (recordIds[0] ?? null))
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
