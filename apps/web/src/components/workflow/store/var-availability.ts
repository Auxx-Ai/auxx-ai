// apps/web/src/components/workflow/store/var-availability.ts

import type { Resource } from '@auxx/lib/resources/client'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import type { BaseType, UnifiedVariable } from '~/components/workflow/types'
import type { OutputVariableContext } from '~/components/workflow/types/output-variables'
import type { EnvVar } from '../types'

/** Per-node output variables (tree form) */
export interface NodeOutput {
  type: string
  dataRef: any
  variables: UnifiedVariable[]
}

/**
 * Compute node outputs by calling the node definition's outputVariables function.
 * The resolveVariable function enables upstream-dependent output computation.
 */
export function computeNodeOutputs(
  nodeId: string,
  nodeType: string,
  data: any,
  resources: Map<string, Resource>,
  resolveVariable: (variableId: string) => UnifiedVariable | undefined
): UnifiedVariable[] {
  const nodeDef = unifiedNodeRegistry.getDefinition(nodeType)
  if (!nodeDef?.outputVariables) return []

  const resource = data.resourceType ? resources.get(data.resourceType) : undefined

  const context: OutputVariableContext = {
    resource,
    allResources: Array.from(resources.values()),
    resolveVariable,
  }

  return nodeDef.outputVariables(data, nodeId, context)
}

/**
 * Convert an EnvVar to UnifiedVariable format.
 * Single conversion function used at the availability boundary.
 */
export function convertEnvVarToUnified(envVar: EnvVar): UnifiedVariable {
  const id = envVar.id || `env.${envVar.name}`
  return {
    id,
    nodeId: 'env',
    label: envVar.name,
    type: (envVar.type || 'string') as BaseType,
    category: 'environment' as const,
    description: '',
  }
}

/**
 * Build a flat lookup index from all variable sources.
 * Walks nodeOutputs trees, converts env vars, includes sys vars.
 * Enables O(1) lookups in useVariable hook.
 */
export function buildVariableIndex(
  nodeOutputs: Map<string, NodeOutput>,
  environmentVariables: Map<string, EnvVar>,
  systemVariables: Map<string, UnifiedVariable>
): Map<string, UnifiedVariable> {
  const index = new Map<string, UnifiedVariable>()

  // Walk all node output trees
  for (const [_nodeId, output] of nodeOutputs) {
    for (const variable of output.variables) {
      flattenIntoIndex(variable, index)
    }
  }

  // Add environment variables
  for (const [_id, envVar] of environmentVariables) {
    const unified = convertEnvVarToUnified(envVar)
    index.set(unified.id, unified)
  }

  // Add system variables
  for (const [id, sysVar] of systemVariables) {
    index.set(id, sysVar)
  }

  return index
}

/**
 * Recursively flatten a variable and all nested properties/items into the index.
 */
function flattenIntoIndex(variable: UnifiedVariable, index: Map<string, UnifiedVariable>): void {
  index.set(variable.id, variable)

  if (variable.properties) {
    for (const prop of Object.values(variable.properties)) {
      flattenIntoIndex(prop, index)
    }
  }

  if (variable.items) {
    flattenIntoIndex(variable.items, index)
  }
}

/**
 * Find a variable by ID in a tree of variables.
 * Recursive tree walk through properties and items.
 */
export function findVariableInTree(
  variables: UnifiedVariable[],
  targetId: string
): UnifiedVariable | undefined {
  for (const v of variables) {
    if (v.id === targetId) return v
    if (v.properties) {
      for (const prop of Object.values(v.properties)) {
        const found = findVariableInTree([prop], targetId)
        if (found) return found
      }
    }
    if (v.items) {
      const found = findVariableInTree([v.items], targetId)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Flatten a variable and all nested properties/items into a flat array.
 * Used for availability computation.
 */
export function flattenVariableForStorage(variable: UnifiedVariable): UnifiedVariable[] {
  const flattened: UnifiedVariable[] = [variable]

  if (variable.properties) {
    for (const prop of Object.values(variable.properties)) {
      flattened.push(...flattenVariableForStorage(prop))
    }
  }

  if (variable.items) {
    flattened.push(...flattenVariableForStorage(variable.items))
  }

  return flattened
}
