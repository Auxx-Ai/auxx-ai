// apps/web/src/components/workflow/nodes/core/find/output-variables.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { generateFindNodeVariablesFromFields } from '@auxx/lib/workflow-engine/client'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { FindNodeData } from './types'

/** Resource shape for variable generation */
type ResourceWithFields = { id: string; label: string; plural: string; fields: ResourceField[] }

/**
 * Generate output variables for find nodes
 * Unified function for both system and custom resources
 *
 * @param data - Find node data
 * @param nodeId - Node ID
 * @param resource - Current resource with fields
 * @param allResources - All available resources (for relationship drilling)
 */
export function getFindNodeOutputVariables(
  data: FindNodeData,
  nodeId: string,
  resource?: ResourceWithFields,
  allResources?: ResourceWithFields[]
): UnifiedVariable[] {
  // No resource selected yet
  if (!resource) {
    return []
  }

  // Build resources map for relationship lookup
  const resourcesMap = new Map(allResources?.map((r) => [r.id, r]) ?? [])

  return generateFindNodeVariablesFromFields(
    resource.fields,
    { id: resource.id, label: resource.label, plural: resource.plural },
    nodeId,
    data.findMode,
    { resourcesMap, maxDepth: 2 }
  )
}
