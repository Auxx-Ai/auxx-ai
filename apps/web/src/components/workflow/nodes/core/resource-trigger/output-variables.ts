// apps/web/src/components/workflow/nodes/core/resource-trigger/output-variables.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { generateResourceTriggerVariablesFromFields } from '@auxx/lib/workflow-engine/client'
import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import type { ResourceTriggerData } from './types'

/** Resource shape for variable generation (matches Find node) */
type ResourceWithFields = { id: string; label: string; plural: string; fields: ResourceField[] }

/**
 * Get output variables for a resource trigger node
 * Unified function for both system resources and custom entities
 *
 * Pattern: Same as Find node - requires resource with fields for generation
 *
 * @param data - Resource trigger node data
 * @param nodeId - Node ID
 * @param resource - Current resource with fields
 * @param allResources - All available resources (for relationship drilling)
 */
export function getResourceTriggerOutputVariables(
  data: ResourceTriggerData,
  nodeId: string,
  resource?: ResourceWithFields,
  allResources?: ResourceWithFields[]
): UnifiedVariable[] {
  // No resource selected yet - return empty (same as Find node)
  if (!resource) {
    return []
  }

  // Build resources map for relationship lookup
  const resourcesMap = new Map(allResources?.map((r) => [r.id, r]) ?? [])

  return generateResourceTriggerVariablesFromFields(
    resource.fields,
    { id: resource.id, label: resource.label, plural: resource.plural },
    nodeId,
    data.operation,
    { resourcesMap, maxDepth: 2 }
  )
}
