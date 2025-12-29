// apps/web/src/components/custom-fields/context/entity-records-context.tsx

'use client'

import { createContext, useContext, useCallback, useMemo } from 'react'
import { useEntityDefinition } from '~/components/resources'
import type { CustomResource, ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'

/**
 * Custom field type compatible with existing consumers
 * Derived from ResourceField with properties transformed for backward compatibility
 */
interface CustomField {
  id: string
  name: string
  type: string
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
    }
    currency?: Record<string, unknown>
  }
  position: number
  active: boolean
  required?: boolean
  description?: string
}

/**
 * Transform ResourceField to CustomField format for backward compatibility
 */
function transformResourceFieldToCustomField(field: ResourceField, index: number): CustomField {
  // Convert BaseType to FieldType for display purposes
  const fieldType = mapBaseTypeToFieldType(field.type)

  // Build options object from ResourceField properties
  const options: CustomField['options'] = {}

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

  // Handle relationship configuration
  if (field.relationship) {
    const isSystemResource = ['contact', 'ticket', 'thread', 'user'].includes(
      field.relationship.targetTable
    )
    options.relationship = {
      // Keep targetTable as-is - it's already the resourceId we need (e.g., "entity_orders")
      relatedEntityDefinitionId: !isSystemResource ? field.relationship.targetTable : undefined,
      relatedModelType: isSystemResource ? field.relationship.targetTable : undefined,
    }
  }

  return {
    id: field.id!,
    name: field.label,
    type: fieldType,
    options: Object.keys(options).length > 0 ? options : undefined,
    position: index, // Position is implicit from array order
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

  /** Build resourceId for a relationship field */
  getResourceIdForField: (field: CustomField) => string | null
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
 * Relationship options type from custom field options
 */
interface RelationshipOptions {
  relatedEntityDefinitionId?: string
  relatedModelType?: string
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

  /**
   * Get resourceId for a relationship field
   * Returns the resourceId directly since targetTable is already in the correct format
   */
  const getResourceIdForField = useCallback((field: CustomField): string | null => {
    if (field.type !== 'RELATIONSHIP') return null

    const relationship = (field.options as { relationship?: RelationshipOptions })?.relationship
    if (!relationship) return null

    // relatedEntityDefinitionId is already in "entity_orders" format = resourceId
    if (relationship.relatedEntityDefinitionId) {
      return relationship.relatedEntityDefinitionId
    }

    // System resources like "contact", "ticket"
    if (relationship.relatedModelType) {
      return relationship.relatedModelType
    }

    return null
  }, [])

  const value = useMemo<EntityRecordsContextValue>(
    () => ({
      resource,
      entityDefinitionId,
      customFields,
      isLoadingResource,
      isLoadingFields,
      getResourceIdForField,
    }),
    [resource, entityDefinitionId, customFields, isLoadingResource, isLoadingFields, getResourceIdForField]
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
