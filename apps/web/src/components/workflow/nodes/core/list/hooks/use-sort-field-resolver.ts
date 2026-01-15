// apps/web/src/components/workflow/nodes/core/list/hooks/use-sort-field-resolver.ts

import { useMemo } from 'react'
import { useFilterFieldResolver } from './use-filter-field-resolver'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import type { FieldDefinition } from '~/components/conditions'
import { useResourceStore } from '~/components/resources/store/resource-store'

/**
 * Sortable field types (direct)
 */
const SORTABLE_TYPES = [
  BaseType.STRING,
  BaseType.NUMBER,
  BaseType.DATE,
  BaseType.DATETIME,
  BaseType.BOOLEAN,
  BaseType.ENUM,
  BaseType.EMAIL,
  BaseType.PHONE,
]

interface UseSortFieldResolverOptions {
  nodeId: string
  inputListValue: string | undefined
}

/**
 * Hook to extract sortable field definitions from an array variable.
 * Supports sorting by relation subfields (e.g., "contact.name").
 */
export function useSortFieldResolver({
  nodeId,
  inputListValue,
}: UseSortFieldResolverOptions) {
  // Reuse the filter field resolver for basic field detection
  const { fieldDefinitions, hasFields, isEmpty } = useFilterFieldResolver({
    nodeId,
    inputListValue,
  })

  /**
   * Expand fields to include relation subfields
   */
  const expandedFields = useMemo((): FieldDefinition[] => {
    const result: FieldDefinition[] = []

    fieldDefinitions.forEach((field) => {
      // Direct sortable field (STRING, NUMBER, DATE, etc.)
      if (SORTABLE_TYPES.includes(field.type)) {
        result.push(field)
      }

      // RELATION field - expand to show sortable subfields
      else if (field.type === BaseType.RELATION && field.fieldReference) {
        // Parse reference: "ticket:contact" or just "contact"
        const parts = field.fieldReference.split(':')
        const targetTable = parts.length === 2 ? parts[1] : parts[0]

        // Get sortable subfields from resource store
        const resource = useResourceStore.getState().resourceMap.get(targetTable)
        if (resource) {
          resource.fields
            .filter((subField) =>
              subField.capabilities.sortable &&
              SORTABLE_TYPES.includes(subField.type)
            )
            .forEach((subField) => {
              result.push({
                id: `${field.id}.${subField.key}`,  // Nested path: "contact.name"
                label: `${field.label} → ${subField.label}`,  // "Contact → Name"
                type: subField.type,
                operators: [], // Not needed for sorting
                description: `Sort by ${field.label}'s ${subField.label}`,
              })
            })
        }
      }

      // REFERENCE field (direct resource object) - expand subfields
      else if (field.type === BaseType.REFERENCE && field.fieldReference) {
        const targetTable = field.fieldReference

        // Get sortable subfields from resource store
        const resource = useResourceStore.getState().resourceMap.get(targetTable)
        if (resource) {
          resource.fields
            .filter((subField) =>
              subField.capabilities.sortable &&
              SORTABLE_TYPES.includes(subField.type)
            )
            .forEach((subField) => {
              result.push({
                id: `${field.id}.${subField.key}`,  // Nested path: "contact.name"
                label: `${field.label} → ${subField.label}`,  // "Contact → Name"
                type: subField.type,
                operators: [], // Not needed for sorting
                description: `Sort by ${field.label}'s ${subField.label}`,
              })
            })
        }
      }
    })

    return result
  }, [fieldDefinitions])

  const hasSortableFields = expandedFields.length > 0

  return {
    /** Sortable field definitions (including expanded relation subfields) */
    sortableFields: expandedFields,
    /** All field definitions (including non-sortable) */
    allFields: fieldDefinitions,
    /** Whether any sortable fields were found */
    hasSortableFields,
    /** Whether any fields were found (sortable or not) */
    hasFields,
    /** Whether no input list is selected */
    isEmpty,
  }
}
