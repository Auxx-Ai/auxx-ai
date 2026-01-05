// apps/web/src/components/custom-fields/ui/field-input-row.tsx
'use client'

import { useMemo } from 'react'
import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import type { FieldOptions } from '~/components/workflow/ui/input-editor/get-input-component'
import {
  mapFieldTypeToBaseType,
  fieldTypeNeedsEnumOptions,
  extractEnumOptions,
} from '~/lib/custom-fields'
import type { FieldType } from '@auxx/database/types'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'

/**
 * Custom field definition interface
 * Matches the CustomField entity from database
 */
interface CustomFieldDef {
  id: string
  name: string
  type: FieldType
  description?: string | null
  required?: boolean | null
  options?: unknown
}

interface FieldInputRowProps {
  /** Custom field definition */
  field: CustomFieldDef
  /** Current value */
  value: unknown
  /** Change handler */
  onChange: (fieldId: string, value: any) => void
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
 * Renders a single custom field input row with VarEditorFieldRow layout
 * Uses MultiRelationInput for relationship fields, ConstantInputAdapter for others
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
  const baseType = mapFieldTypeToBaseType(field.type)
  const isRequired = field.required ?? false

  // Build fieldOptions with enum embedded if applicable
  const fieldOptions: FieldOptions | undefined = fieldTypeNeedsEnumOptions(field.type)
    ? { ...(field.options as object), enum: extractEnumOptions(field.options) }
    : (field.options as FieldOptions | undefined)

  // For relationship fields, resolve tableId or apiSlug from field options
  // Returns { tableId?, apiSlug? } based on the stored format
  const resourceRef = useMemo(() => {
    if (field.type !== 'RELATIONSHIP') return null

    const relationship = (field.options as { relationship?: {
      relatedEntityDefinitionId?: string
      relatedResourceId?: string
      relatedModelType?: string
    } })?.relationship
    if (!relationship) return null

    // System resource (contact, ticket, etc.) - use as tableId directly
    if (relationship.relatedModelType) {
      return { tableId: relationship.relatedModelType }
    }

    // Check relatedResourceId (might be stored directly)
    if (relationship.relatedResourceId) {
      // Already in entity_xxx format or system resource
      if (relationship.relatedResourceId.startsWith('entity_')) {
        return { tableId: relationship.relatedResourceId }
      }
      // Could be system resource or raw apiSlug
      return { apiSlug: relationship.relatedResourceId }
    }

    // relatedEntityDefinitionId could be UUID or apiSlug - let server resolve
    if (relationship.relatedEntityDefinitionId) {
      const value = relationship.relatedEntityDefinitionId
      // Already in entity_xxx format
      if (value.startsWith('entity_')) {
        return { tableId: value }
      }
      // UUID or raw apiSlug - let server resolve via apiSlug param
      return { apiSlug: value }
    }

    return null
  }, [field])

  // Normalize relationship value to array of IDs
  const relationshipIds = useMemo(() => {
    if (field.type !== 'RELATIONSHIP') return []
    return normalizeToIdArray(value)
  }, [field.type, value])

  // Determine if relationship is multi-select
  const isMultiRelationship = useMemo(() => {
    if (field.type !== 'RELATIONSHIP') return false
    const relationship = (field.options as any)?.relationship
    return relationship?.relationshipType === 'has_many'
  }, [field])

  // Get relatedEntityDefinitionId from field options
  const relatedEntityDefinitionId = useMemo(() => {
    if (field.type !== 'RELATIONSHIP') return null
    const relationship = (field.options as { relationship?: {
      relatedEntityDefinitionId?: string
      relatedModelType?: string
    } })?.relationship
    // For custom entities, use stored relatedEntityDefinitionId
    // For system resources, use relatedModelType
    return relationship?.relatedEntityDefinitionId ?? relationship?.relatedModelType ?? null
  }, [field])

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
    onChange(field.id, isMultiRelationship ? values : values[0] ?? null)
  }

  // Render relationship field with MultiRelationInput
  if (field.type === 'RELATIONSHIP' && resourceRef) {
    return (
      <VarEditorFieldRow
        title={field.name}
        description={field.description ?? undefined}
        type={baseType}
        isRequired={isRequired}
        validationError={validationError}
        validationType={validationType}
        showIcon={true}>
        <MultiRelationInput
          tableId={resourceRef.tableId}
          apiSlug={resourceRef.apiSlug}
          value={relationshipIds}
          onChange={handleRelationshipChange}
          placeholder={placeholder ?? `Select ${field.name.toLowerCase()}...`}
          disabled={disabled}
          multi={isMultiRelationship}
        />
      </VarEditorFieldRow>
    )
  }

  // For all other field types, use ConstantInputAdapter
  return (
    <VarEditorFieldRow
      title={field.name}
      description={field.description ?? undefined}
      type={baseType}
      isRequired={isRequired}
      validationError={validationError}
      validationType={validationType}
      showIcon={true}>
      <ConstantInputAdapter
        value={value}
        onChange={(_, val) => onChange(field.id, val)}
        varType={baseType}
        placeholder={placeholder ?? `Enter ${field.name.toLowerCase()}...`}
        disabled={disabled}
        fieldOptions={fieldOptions}
      />
    </VarEditorFieldRow>
  )
}

/**
 * Normalize value formats to array of IDs
 * Handles: TypedFieldValue[], TypedFieldValue, string[], string
 * STRICT: Rejects legacy { data: x } format
 */
function normalizeToIdArray(value: unknown): string[] {
  if (!value) return []

  // STRICT: Reject legacy { data: x } format
  if (typeof value === 'object' && 'data' in (value as any) && !('type' in (value as any))) {
    console.error('[FieldInputRow] Legacy { data: x } format detected. All values must be TypedFieldValue.')
    return []
  }

  // Handle TypedFieldValue array (e.g., OptionFieldValue[], RelationshipFieldValue[])
  if (Array.isArray(value)) {
    return value.map((v: any) => {
      if (typeof v === 'object' && v !== null && 'type' in v) {
        return v.optionId ?? v.relatedEntityId ?? v.value
      }
      return typeof v === 'string' ? v : null
    }).filter((id): id is string => id !== null)
  }

  // Handle single TypedFieldValue
  if (typeof value === 'object' && 'type' in (value as any)) {
    const tv = value as { optionId?: string; relatedEntityId?: string; value?: string }
    const id = tv.optionId ?? tv.relatedEntityId ?? tv.value
    return id ? [id] : []
  }

  // Handle single string (pre-extracted ID)
  if (typeof value === 'string' && value) {
    return [value]
  }

  return []
}
