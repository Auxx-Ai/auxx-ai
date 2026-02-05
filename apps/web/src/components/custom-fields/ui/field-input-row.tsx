// apps/web/src/components/custom-fields/ui/field-input-row.tsx
'use client'

import { VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import {
  extractRelationshipRecordIds,
  isMultiRelationship,
  type RecordId,
} from '@auxx/lib/field-values/client'
import { type RelationshipConfig, type ActorOptions } from '@auxx/types/custom-field'
import type { ResourceField } from '@auxx/lib/resources/client'
import { isActorId, toActorId, type ActorId } from '@auxx/types/actor'

/**
 * Extract ActorIds from various value formats.
 * Handles: ActorId string, { actorType, id, actorId }, array of either
 */
function extractActorIds(value: unknown): ActorId[] {
  if (!value) return []

  if (Array.isArray(value)) {
    return value.map(extractSingleActorId).filter((id): id is ActorId => id !== null)
  }

  const actorId = extractSingleActorId(value)
  return actorId ? [actorId] : []
}

/**
 * Extract single ActorId from value
 */
function extractSingleActorId(val: unknown): ActorId | null {
  if (!val) return null

  if (typeof val === 'string' && isActorId(val)) {
    return val as ActorId
  }

  if (typeof val === 'object' && val !== null) {
    const obj = val as { actorType?: 'user' | 'group'; id?: string; actorId?: ActorId }
    if (obj.actorId && isActorId(obj.actorId)) {
      return obj.actorId
    }
    if (obj.actorType && obj.id) {
      return toActorId(obj.actorType, obj.id)
    }
  }

  return null
}

/**
 * Normalize NAME value to { firstName, lastName } structure
 */
function normalizeNameValue(value: unknown): { firstName: string; lastName: string } {
  if (!value || typeof value !== 'object') {
    return { firstName: '', lastName: '' }
  }
  const v = value as { firstName?: string; lastName?: string }
  return {
    firstName: v.firstName ?? '',
    lastName: v.lastName ?? '',
  }
}

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
  const actorConfig = field.options?.actor as ActorOptions | undefined

  // Normalize value for different field types
  const normalizedValue =
    fieldType === 'RELATIONSHIP'
      ? extractRelationshipRecordIds(value)
      : fieldType === 'ACTOR'
        ? extractActorIds(value)
        : fieldType === 'NAME'
          ? normalizeNameValue(value)
          : value

  // Determine if relationship is multi-select using helper
  const isMulti = isMultiRelationship(relationshipConfig?.relationshipType)

  /**
   * Handle value changes from FieldInputAdapter
   * For relationships: pass RecordId[] directly (converter handles wrapping)
   * For actors: pass ActorId[] directly
   */
  const handleChange = (newValue: unknown) => {
    if (fieldType === 'RELATIONSHIP') {
      // Pass RecordId[] directly - converter handles wrapping
      const recordIds = newValue as RecordId[]
      onChange(field.id!, isMulti ? recordIds : (recordIds[0] ?? null))
    } else if (fieldType === 'ACTOR') {
      // Pass ActorId[] - unwrap to single if not multi
      const actorIds = newValue as ActorId[]
      const isMultiActor = actorConfig?.multiple ?? false
      onChange(field.id!, isMultiActor ? actorIds : (actorIds[0] ?? null))
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
        triggerProps={{ className: 'ps-0 pe-1 w-full' }}
      />
    </VarEditorFieldRow>
  )
}
