// apps/web/src/components/workflow/nodes/shared/node-inputs/relation-input.tsx

'use client'

import {
  isMultiRelationship,
  isRecordId,
  type RecordId,
  toRecordId,
  toRecordIds,
} from '@auxx/lib/field-values/client'
import {
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
  type RelationshipType,
} from '@auxx/types/custom-field'
import { isResourceFieldId, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useCallback, useMemo } from 'react'
import { useResourceFields } from '~/components/resources'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface RelationInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Field reference: "resourceType:fieldKey" or just "resourceId" for direct */
  fieldReference?: string
  /** Direct resource type when fieldReference is absent (e.g. "thread", "message") */
  relatedEntityDefinitionId?: string
  /** Relationship cardinality type (has_many, belongs_to, etc.) */
  relationshipType?: RelationshipType
  /** Whether to show the clear button on the picker trigger (defaults to multi value) */
  showClear?: boolean
}

/**
 * Relation input following node-input interface
 * Resolves fieldReference to resourceId using useResourceFields
 */
export const RelationInput = createNodeInput<RelationInputProps>(
  ({
    inputs,
    onChange,
    isLoading,
    name,
    placeholder,
    fieldReference,
    relatedEntityDefinitionId,
    relationshipType,
    showClear,
  }) => {
    const isMulti = isMultiRelationship(relationshipType)
    // Parse fieldReference to get resourceType and fieldKey using typed parsing
    const [resourceType, fieldKey] = useMemo(() => {
      if (!fieldReference) return [null, null]
      if (!isResourceFieldId(fieldReference)) return [null, null] // Direct resource
      const { entityDefinitionId, fieldId } = parseResourceFieldId(
        fieldReference as ResourceFieldId
      )
      return [entityDefinitionId, fieldId]
    }, [fieldReference])

    // Get fields for resourceType (to resolve relationship target)
    const { fields, isLoading: isLoadingFields } = useResourceFields(resourceType)

    // Resolve target resourceId
    const targetResourceId = useMemo(() => {
      if (!fieldReference) return relatedEntityDefinitionId || null

      // Direct resource reference (e.g., "contact")
      if (!isResourceFieldId(fieldReference)) {
        return fieldReference
      }

      // Lookup field to get relationship target (fieldKey may be a key or an id)
      const field = fields.find((f) => f.key === fieldKey || f.id === fieldKey)
      const resolved = field?.relationship
        ? getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
        : null

      // Fall back to relatedEntityDefinitionId when field lookup can't resolve the target
      // (e.g. when inverseResourceFieldId is null in the registry)
      return resolved || relatedEntityDefinitionId || null
    }, [fieldReference, fields, fieldKey, relatedEntityDefinitionId])

    // Get current value from inputs
    const value = inputs[name] ?? ''

    // Parse value to RecordId[] (handle RecordIds, plain IDs, and arrays)
    const selectedRecordIds = useMemo(() => {
      if (!value || !targetResourceId) return []

      if (Array.isArray(value)) {
        return value.map((id: string) => (isRecordId(id) ? id : toRecordId(targetResourceId, id)))
      }

      if (typeof value === 'string') {
        return [isRecordId(value) ? value : toRecordId(targetResourceId, value)]
      }

      return []
    }, [value, targetResourceId])

    // Handle change - store RecordIds directly (entityDefId:instanceId format)
    const handleChange = useCallback(
      (recordIds: RecordId[]) => {
        if (isMulti) {
          onChange(name, recordIds.length > 0 ? recordIds : '')
        } else {
          onChange(name, recordIds[0] ?? '')
        }
      },
      [onChange, name, isMulti]
    )

    // Loading state while resolving fields
    if (resourceType && isLoadingFields) {
      return <Skeleton className='h-8 w-full' />
    }

    // Error state - missing or invalid fieldReference
    if (!targetResourceId) {
      return (
        <div className='text-sm text-destructive flex items-center h-8'>
          {fieldReference ? `Invalid relationship: ${fieldReference}` : 'Missing field reference'}
        </div>
      )
    }

    return (
      <MultiRelationInput
        entityDefinitionId={targetResourceId}
        value={selectedRecordIds}
        onChange={handleChange}
        disabled={isLoading}
        placeholder={placeholder}
        multi={isMulti}
        triggerProps={{ className: 'w-full pe-1 ps-0', showClear }}
      />
    )
  }
)
