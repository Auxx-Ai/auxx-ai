// apps/web/src/components/custom-fields/context/entity-records-context.tsx

'use client'

import { createContext, useContext, useMemo } from 'react'
import { useEntityDefinition } from '~/components/resources'
import type { CustomResource, ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import type { FieldType } from '@auxx/database/types'

/**
 * Custom field type compatible with existing consumers
 * Derived from ResourceField with properties transformed for backward compatibility
 */
export interface CustomField {
  id: string
  name: string
  type: FieldType
  options?: {
    options?: Array<{
      label: string
      value: string
      color?: string
      targetTimeInStatus?: { value: number; unit: 'days' | 'months' | 'years' }
      celebration?: boolean
    }>
    relationship?: {
      relatedEntityDefinitionId?: string
      relatedModelType?: string
      relationshipType?: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
      /** Whether this is the inverse side of the relationship */
      isInverse?: boolean
      /** Field ID on the related entity that points back */
      inverseFieldId?: string
      /** Field to display for related entities */
      displayFieldId?: string
    }
    currency?: Record<string, unknown>
  }
  sortOrder: string
  active: boolean
  required?: boolean
  description?: string
}

/**
 * Transform ResourceField to CustomField format for backward compatibility
 */
export function transformResourceFieldToCustomField(
  field: ResourceField,
  index: number
): CustomField {
  // Convert BaseType to FieldType for display purposes
  const fieldType = mapBaseTypeToFieldType(field.type)

  // Start with field.options as base (contains flat display options like checkboxStyle, decimals, format, etc.)
  const options: NonNullable<CustomField['options']> = { ...field.options! }

  // Handle enum values for select fields (including kanban metadata)
  if (field.enumValues && field.enumValues.length > 0) {
    options.options = field.enumValues.map((e) => ({
      label: e.label,
      value: e.dbValue,
      color: e.color,
      targetTimeInStatus: e.targetTimeInStatus,
      celebration: e.celebration,
    }))
  }

  // Handle relationship configuration - pass through full options.relationship from resource registry
  // This includes: isInverse, inverseFieldId, displayFieldId, relationshipType, relatedEntityDefinitionId, relatedModelType
  if (field.options?.relationship) {
    options.relationship = field.options.relationship as CustomField['options']['relationship']
  }

  return {
    id: field.id!,
    name: field.label,
    type: fieldType,
    options,
    sortOrder: String(index), // Position is implicit from array order
    active: true, // ResourceField doesn't track active state, assume active
    required: field.capabilities?.required,
    description: field.description,
  }
}

/**
 * Context value for entity records provider
 */
interface EntityRecordsContextValue {
  /** The custom resource (contains entity definition data) */
  resource: CustomResource | undefined

  /** Entity definition ID (convenience accessor) */
  entityDefinitionId: string | undefined

  /** Custom fields for this entity */
  customFields: CustomField[]

  /** Loading state for resource */
  isLoadingResource: boolean

  /** Loading state for custom fields */
  isLoadingFields: boolean
}

const EntityRecordsContext = createContext<EntityRecordsContextValue | null>(null)

/**
 * Props for EntityRecordsProvider
 */
interface EntityRecordsProviderProps {
  slug: string
  children: React.ReactNode
}

/**
 * Provider component that manages custom fields for entity records
 * Uses the unified ResourceProvider for entity definition and relationship resolution
 */
export function EntityRecordsProvider({ slug, children }: EntityRecordsProviderProps) {
  // Get entity definition from unified resources (preloaded)
  const { resource, entityDefinitionId, isLoading: isLoadingResource } = useEntityDefinition(slug)

  // Custom fields derived from resource fields (single source of truth)
  // Transform ResourceField to CustomField format for backward compatibility
  const customFields = useMemo(() => {
    if (!resource) return []
    // Filter to only custom fields (those with id set - custom fields have database IDs)
    return resource.fields
      .filter((f): f is ResourceField & { id: string } => !!f.id)
      .map((field, index) => transformResourceFieldToCustomField(field, index))
  }, [resource])

  // Loading state for fields matches resource loading (no separate query)
  const isLoadingFields = isLoadingResource

  const value = useMemo<EntityRecordsContextValue>(
    () => ({
      resource,
      entityDefinitionId,
      customFields,
      isLoadingResource,
      isLoadingFields,
    }),
    [resource, entityDefinitionId, customFields, isLoadingResource, isLoadingFields]
  )

  return <EntityRecordsContext.Provider value={value}>{children}</EntityRecordsContext.Provider>
}

/**
 * Hook to access entity records context
 * Must be used within EntityRecordsProvider
 */
export function useEntityRecords() {
  const context = useContext(EntityRecordsContext)
  if (!context) {
    throw new Error('useEntityRecords must be used within EntityRecordsProvider')
  }
  return context
}
