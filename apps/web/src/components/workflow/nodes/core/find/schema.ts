// apps/web/src/components/workflow/nodes/actions/find/schema.ts

import { type NodeDefinition, NodeCategory } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { type FindNodeData, createFindNodeDefaultData, findNodeDataSchema } from './types'
import { validateFindNodeConfig } from './validation'
import { getFindNodeOutputVariables } from './output-variables'
import { FindPanel } from './panel'
import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import type { Condition, ConditionGroup } from '~/components/conditions'

/**
 * Extract variables from find node filter conditions
 * Matches backend implementation in packages/lib/src/workflow-engine/nodes/action-nodes/find.ts:501-543
 */
export function extractFindVariables(data: Partial<FindNodeData>): string[] {
  const variableIds = new Set<string>()

  // Extract from flat conditions (backward compatibility)
  if (data.conditions && Array.isArray(data.conditions)) {
    data.conditions.forEach((condition: Condition) => {
      // Add variableId if present
      if (condition.variableId) {
        variableIds.add(condition.variableId)
      }

      // Extract from value if it's a string with {{variables}}
      if (condition.value && typeof condition.value === 'string') {
        extractVarIdsFromString(condition.value).forEach((id) => variableIds.add(id))
      }
    })
  }

  // Extract from condition groups
  if (data.conditionGroups && Array.isArray(data.conditionGroups)) {
    data.conditionGroups.forEach((group: ConditionGroup) => {
      group.conditions?.forEach((condition: Condition) => {
        // Add variableId if present
        if (condition.variableId) {
          variableIds.add(condition.variableId)
        }

        // Extract from value if it's a string with {{variables}}
        if (condition.value && typeof condition.value === 'string') {
          extractVarIdsFromString(condition.value).forEach((id) => variableIds.add(id))
        }
      })
    })
  }

  // Extract from limit if it's a string with variable reference
  if (data.limit && typeof data.limit === 'string') {
    extractVarIdsFromString(data.limit).forEach((id) => variableIds.add(id))
  }

  return Array.from(variableIds)
}

/**
 * Find node definition for the workflow system
 */
export const findDefinition: NodeDefinition<FindNodeData> = {
  id: NodeType.FIND,
  category: NodeCategory.ACTION,
  displayName: 'Find',
  description: 'Search for records with dynamic filters and sorting',
  icon: 'search',
  color: '#10b981', // ACTION category color
  canRunSingle: true, // Can run as a single node
  defaultData: createFindNodeDefaultData(),
  schema: findNodeDataSchema,
  panel: FindPanel,
  extractVariables: extractFindVariables,
  validator: validateFindNodeConfig,
  outputVariables: (data: FindNodeData, nodeId: string, resource, allResources) =>
    getFindNodeOutputVariables(data, nodeId, resource, allResources),
}
