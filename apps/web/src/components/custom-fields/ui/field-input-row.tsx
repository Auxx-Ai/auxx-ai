// apps/web/src/components/custom-fields/ui/field-input-row.tsx
'use client'

import { useMemo } from 'react'
import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import type { FieldOptions } from '~/components/workflow/ui/input-editor/get-input-component'
import { extractRelationshipData } from '@auxx/lib/field-values/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'

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
 * Uses MultiRelationInput for relationship fields, ConstantInputAdapter for others.
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

  // For relationship fields, get config from field.options.relationship
  const relationshipConfig = field.options?.relationship

  // Normalize relationship value to array of IDs
  const relationshipIds = useMemo(() => {
    if (fieldType !== 'RELATIONSHIP') return []
    return extractRelationshipData(value).ids
  }, [fieldType, value])

  // Determine if relationship is multi-select
  const isMultiRelationship = relationshipConfig?.relationshipType === 'has_many'

  // Get relatedEntityDefinitionId from relationship config
  const relatedEntityDefinitionId =
    relationshipConfig?.relatedEntityDefinitionId ?? relationshipConfig?.relatedModelType ?? null

  // Handle relationship field change - wrap IDs with relatedEntityDefinitionId
  const handleRelationshipChange = (ids: string[]) => {
    if (!relatedEntityDefinitionId) {
      console.error('[FieldInputRow] Missing relatedEntityDefinitionId for relationship field')
      return
    }
    const values = ids.map((id) => ({
      relatedEntityId: id,
      relatedEntityDefinitionId,
    }))
    onChange(field.id!, isMultiRelationship ? values : (values[0] ?? null))
  }

  // Render relationship field with MultiRelationInput
  if (fieldType === 'RELATIONSHIP' && relationshipConfig) {
    return (
      <VarEditorFieldRow
        title={field.label}
        description={field.description}
        type={field.type}
        isRequired={isRequired}
        validationError={validationError}
        validationType={validationType}
        showIcon>
        <MultiRelationInput
          relationship={relationshipConfig}
          value={relationshipIds}
          onChange={handleRelationshipChange}
          placeholder={placeholder ?? `Select ${field.label.toLowerCase()}...`}
          disabled={disabled}
        />
      </VarEditorFieldRow>
    )
  }

  // For all other field types, use ConstantInputAdapter
  return (
    <VarEditorFieldRow
      title={field.label}
      description={field.description}
      type={field.type}
      isRequired={isRequired}
      validationError={validationError}
      validationType={validationType}
      showIcon>
      <ConstantInputAdapter
        value={value}
        onChange={(_, val) => onChange(field.id!, val)}
        varType={field.type}
        placeholder={placeholder ?? `Enter ${field.label.toLowerCase()}...`}
        disabled={disabled}
        fieldOptions={field.options}
      />
    </VarEditorFieldRow>
  )
}
