// apps/web/src/components/workflow/nodes/shared/node-inputs/relation-input.tsx

'use client'

import { useMemo, useCallback } from 'react'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { useResourceFields } from '~/components/resources'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { createNodeInput, type NodeInputProps } from './base-node-input'

interface RelationInputProps extends NodeInputProps {
  /** Field name */
  name: string
  /** Placeholder text */
  placeholder?: string
  /** Field reference: "resourceType:fieldKey" or just "resourceId" for direct */
  fieldReference?: string
}

/**
 * Relation input following node-input interface
 * Resolves fieldReference to resourceId using useResourceFields
 */
export const RelationInput = createNodeInput<RelationInputProps>(
  ({ inputs, onChange, isLoading, name, placeholder, fieldReference }) => {
    // Parse fieldReference to get resourceType and fieldKey
    const [resourceType, fieldKey] = useMemo(() => {
      if (!fieldReference) return [null, null]
      if (!fieldReference.includes(':')) return [null, null] // Direct resource
      return fieldReference.split(':') as [string, string]
    }, [fieldReference])

    // Get fields for resourceType (to resolve relationship target)
    const { fields, isLoading: isLoadingFields } = useResourceFields(resourceType)

    // Resolve target resourceId
    const targetResourceId = useMemo(() => {
      if (!fieldReference) return null

      // Direct resource reference (e.g., "contact")
      if (!fieldReference.includes(':')) {
        return fieldReference
      }

      // Lookup field to get relationship target
      const field = fields.find((f) => f.key === fieldKey)
      return field?.relationship?.targetTable ?? null
    }, [fieldReference, fields, fieldKey])

    // Get current value from inputs
    const value = inputs[name] ?? ''

    // Parse value to array format (handle legacy formats)
    const arrayValue = useMemo(() => {
      if (!value) return []
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          if (parsed.referenceId) return [parsed.referenceId]
          if (Array.isArray(parsed)) return parsed
        } catch {
          // Plain string ID
        }
        return [value]
      }
      return []
    }, [value])

    // Handle change - convert back to string ID
    const handleChange = useCallback(
      (ids: string[]) => {
        const id = ids[0] ?? ''
        onChange(name, id)
      },
      [onChange, name]
    )

    // Loading state while resolving fields
    if (resourceType && isLoadingFields) {
      return <Skeleton className="h-8 w-full" />
    }

    // Error state - missing or invalid fieldReference
    if (!targetResourceId) {
      return (
        <div className="text-sm text-destructive flex items-center h-8">
          {fieldReference ? `Invalid relationship: ${fieldReference}` : 'Missing field reference'}
        </div>
      )
    }

    return (
      <MultiRelationInput
        resourceId={targetResourceId}
        value={arrayValue}
        onChange={handleChange}
        disabled={isLoading}
        placeholder={placeholder}
        multi={false}
      />
    )
  }
)
