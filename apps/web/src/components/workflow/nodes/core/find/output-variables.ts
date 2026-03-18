// apps/web/src/components/workflow/nodes/core/find/output-variables.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { generateFindNodeVariablesFromFields } from '@auxx/lib/workflow-engine/client'
import type { OutputVariableContext } from '~/components/workflow/types/output-variables'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { FindNodeData } from './types'

/** Resource shape for variable generation */
type ResourceWithFields = {
  id: string
  label: string
  plural: string
  fields: ResourceField[]
  entityDefinitionId?: string
}

/**
 * Generate output variables for find nodes
 * Unified function for both system and custom resources
 *
 * @param data - Find node data
 * @param nodeId - Node ID
 * @param context - Output variable context with resource access
 */
export function getFindNodeOutputVariables(
  data: FindNodeData,
  nodeId: string,
  context: OutputVariableContext
): UnifiedVariable[] {
  const resource = context.resource as ResourceWithFields | undefined
  const allResources = context.allResources as ResourceWithFields[]
  // No resource selected yet
  if (!resource) {
    return []
  }

  // Build resources map for relationship lookup
  const resourcesMap = new Map(allResources?.map((r) => [r.id, r]) ?? [])

  return generateFindNodeVariablesFromFields(
    resource.fields,
    {
      id: resource.entityDefinitionId ?? resource.id,
      label: resource.label,
      plural: resource.plural,
    },
    nodeId,
    data.findMode,
    { resourcesMap, maxDepth: 2 }
  )
}
