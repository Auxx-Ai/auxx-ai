// apps/web/src/components/workflow/nodes/core/list/hooks/use-pluck-field-resolver.ts

import { useMemo } from 'react'
import { useFilterFieldResolver } from './use-filter-field-resolver'
import { BaseType } from '@auxx/lib/workflow-engine/client'
import type { FieldDefinition } from '~/components/conditions'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { parseResourceFieldId, isResourceFieldId, type ResourceFieldId } from '@auxx/types/field'

/**
 * Maximum depth for nested field expansion.
 * Prevents infinite recursion and keeps UI manageable.
 */
const MAX_NESTING_DEPTH = 5

interface UsePluckFieldResolverOptions {
  nodeId: string
  inputListValue: string | undefined
}

/**
 * Recursively expand a field's subfields up to MAX_NESTING_DEPTH.
 *
 * @param field - The field to expand
 * @param depth - Current recursion depth
 * @param pathPrefix - Accumulated field path (e.g., "contact.createdBy")
 * @param labelPrefix - Accumulated field label (e.g., "Contact → Created By")
 * @param visited - Set of visited paths to prevent circular references
 * @returns Array of expanded field definitions
 */
function expandFieldRecursive(
  field: FieldDefinition,
  depth: number,
  pathPrefix: string,
  labelPrefix: string,
  visited: Set<string> = new Set(),
): FieldDefinition[] {
  const results: FieldDefinition[] = []

  // Prevent infinite recursion
  if (depth >= MAX_NESTING_DEPTH) return results

  // Prevent circular references
  const visitKey = `${pathPrefix}.${field.id}`
  if (visited.has(visitKey)) return results
  visited.add(visitKey)

  // If field is RELATION or REFERENCE, expand its subfields
  if (
    (field.type === BaseType.RELATION || field.type === BaseType.REFERENCE) &&
    field.fieldReference
  ) {
    // Parse reference using typed parsing: "ticket:contact" or just "contact"
    const targetTable = isResourceFieldId(field.fieldReference)
      ? parseResourceFieldId(field.fieldReference as ResourceFieldId).fieldId
      : field.fieldReference

    // Get subfields from resource store (via getState for non-reactive access)
    const resource = useResourceStore.getState().resourceMap.get(targetTable)
    if (resource) {
      resource.fields.forEach((subField) => {
        const newPath = pathPrefix ? `${pathPrefix}.${subField.key}` : subField.key
        const newLabel = labelPrefix ? `${labelPrefix} → ${subField.label}` : subField.label

        // Add the subfield itself (all types are pluckable)
        results.push({
          id: newPath,
          label: newLabel,
          type: subField.type,
          operators: [],
          description: subField.description,
          // Preserve reference info for further expansion
          ...(subField.type === BaseType.RELATION || subField.type === BaseType.REFERENCE
            ? { fieldReference: targetTable }
            : {}),
        })

        // Recursively expand if this subfield is also a RELATION/REFERENCE
        if (
          (subField.type === BaseType.RELATION || subField.type === BaseType.REFERENCE) &&
          depth + 1 < MAX_NESTING_DEPTH
        ) {
          const nestedFields = expandFieldRecursive(
            {
              id: subField.key,
              label: subField.label,
              type: subField.type,
              operators: [],
              fieldReference: targetTable,
            },
            depth + 1,
            newPath,
            newLabel,
            new Set(visited),
          )
          results.push(...nestedFields)
        }
      })
    }
  }

  return results
}

/**
 * Hook to extract all pluckable field definitions from an array variable.
 * Supports ALL field types and deep nested paths (e.g., "contact.createdBy.firstName").
 *
 * Unlike sort which only supports sortable types, pluck can extract ANY field type:
 * - Primitives: STRING, NUMBER, BOOLEAN, DATE, etc.
 * - Complex: OBJECT, ARRAY, JSON
 * - Relations: REFERENCE, RELATION (expanded with subfields)
 * - Deep nesting: unlimited depth (configurable via MAX_NESTING_DEPTH)
 */
export function usePluckFieldResolver({
  nodeId,
  inputListValue,
}: UsePluckFieldResolverOptions) {
  // Reuse the filter field resolver for basic field detection
  const { fieldDefinitions, hasFields, isEmpty } = useFilterFieldResolver({
    nodeId,
    inputListValue,
  })

  /**
   * Expand ALL fields (including complex types and deep nesting).
   */
  const expandedFields = useMemo((): FieldDefinition[] => {
    const result: FieldDefinition[] = []

    fieldDefinitions.forEach((field) => {
      // Add the field itself (all types are pluckable)
      result.push(field)

      // If field is RELATION or REFERENCE, expand subfields recursively
      if (field.type === BaseType.RELATION || field.type === BaseType.REFERENCE) {
        const nested = expandFieldRecursive(
          field,
          0, // Start at depth 0
          field.id, // Path prefix
          field.label, // Label prefix
        )
        result.push(...nested)
      }
    })

    return result
  }, [fieldDefinitions])

  const hasPluckableFields = expandedFields.length > 0

  return {
    /** All pluckable field definitions (including deep nested fields) */
    pluckableFields: expandedFields,
    /** All field definitions (from filter resolver, before expansion) */
    allFields: fieldDefinitions,
    /** Whether any pluckable fields were found */
    hasPluckableFields,
    /** Whether any fields were found (before expansion) */
    hasFields,
    /** Whether no input list is selected */
    isEmpty,
  }
}
