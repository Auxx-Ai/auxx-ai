// apps/web/src/components/workflow/nodes/core/list/hooks/use-filter-field-resolver.ts

import {
  BaseType,
  getFieldOperators,
  getOperatorsForType,
  type Operator,
} from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { useMemo } from 'react'
import type { FieldDefinition } from '~/components/conditions'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useVariable } from '~/components/workflow/hooks/use-var-store-sync'
import { isNodeVariable } from '~/components/workflow/utils/variable-utils'

/**
 * Options for the field resolver hook
 */
interface UseFilterFieldResolverOptions {
  /** The ID of the current node */
  nodeId: string
  /** The raw value from inputList (could be variable or TiptapJSON) */
  inputListValue: string | undefined
}

/**
 * Hook to extract field definitions from an array variable's metadata.
 *
 * This hook analyzes the input array variable and extracts field definitions
 * from its items metadata, supporting:
 * - Object arrays with defined properties
 * - Resource references (contacts, tickets, etc.)
 * - Primitive arrays (string[], number[], etc.)
 *
 * @param options - Configuration options
 * @returns Field definitions, availability flags, and state information
 */
export function useFilterFieldResolver({ nodeId, inputListValue }: UseFilterFieldResolverOptions) {
  // const { allVariables } = useAvailableVariables({ nodeId })
  const { variable } = useVariable(inputListValue, nodeId)

  const fieldDefinitions = useMemo((): FieldDefinition[] => {
    if (!inputListValue) {
      return [] // No array selected
    }

    // PICKER mode returns plain variable ID (e.g., "find-123.results")
    // Validate it's a proper node variable format
    if (!isNodeVariable(inputListValue)) {
      return []
    }

    // Find the array variable
    if (!variable) {
      return []
    }

    if (variable.type !== BaseType.ARRAY) {
      return []
    }

    // Get the item definition from the array
    const itemVar = variable.items

    if (!itemVar) {
      return []
    }
    // CASE 1: Item is a reference to a known resource type
    if (itemVar.resourceId) {
      const resource = useResourceStore.getState().resourceMap.get(itemVar.resourceId)
      if (resource) {
        const filterableFields = resource.fields
          .filter((field) => field.capabilities.filterable && !field.capabilities.hidden)
          .map(
            (field): FieldDefinition => ({
              id: toResourceFieldId(itemVar.resourceId!, field.key),
              label: field.label,
              type: field.type,
              fieldType: field.fieldType,
              fieldKey: field.key,
              operators: getFieldOperators(field) as Operator[],
              options: field.options,
              ...(field.type === BaseType.RELATION &&
                field.relationship && {
                  fieldReference: toResourceFieldId(itemVar.resourceId!, field.key),
                  targetEntityDefinitionId:
                    getRelatedEntityDefinitionId(field.relationship as RelationshipConfig) ??
                    undefined,
                }),
            })
          )
        return filterableFields
      }
    }

    // CASE 2: Item has properties (object with defined fields)
    if (itemVar.properties) {
      const fields = Object.entries(itemVar.properties).map(
        ([key, prop]): FieldDefinition => ({
          id: key,
          label: prop.label || key,
          type: prop.type,
          operators: getOperatorsForType(prop.type),
          options: prop.options,
          description: prop.description,
          // Preserve field reference for relation types
          ...(prop.fieldReference
            ? { fieldReference: prop.fieldReference }
            : prop.resourceId && itemVar.resourceId
              ? { fieldReference: toResourceFieldId(itemVar.resourceId, key) }
              : {}),
        })
      )
      return fields
    }

    // CASE 3: Item is a primitive type (rare but possible)
    // Example: string[], number[]
    if ([BaseType.STRING, BaseType.NUMBER, BaseType.BOOLEAN].includes(itemVar.type)) {
      return [
        {
          id: '_value',
          label: 'Value',
          type: itemVar.type,
          operators: getOperatorsForType(itemVar.type),
          description: 'The item value',
        },
      ]
    }

    return []
  }, [variable, inputListValue])

  const hasFields = fieldDefinitions.length > 0
  const isEmpty = !inputListValue
  const entityDefinitionId = variable?.items?.resourceId ?? undefined

  return {
    /** Extracted field definitions for the array items */
    fieldDefinitions,
    /** Entity definition ID for NavigableFieldSelector drill-down */
    entityDefinitionId,
    /** Whether any fields were found */
    hasFields,
    /** Whether no input list is selected */
    isEmpty,
  }
}
