// apps/web/src/components/workflow/store/use-var-store.ts

import type { Resource } from '@auxx/lib/resources/client'
import type { Edge, Node } from '@xyflow/react'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types'
import { getUpstreamNodeIds } from '~/components/workflow/utils/graph-utils'
import { cloneAndRewriteVariableIds } from '~/components/workflow/utils/variable-cloning'
import { getNodeIdFromVariableId } from '~/components/workflow/utils/variable-utils'
import type { EnvVar } from '../types'
import { useWorkflowStore } from './workflow-store'

export interface LoopContext {
  loopNodeId: string
  iteratorName: string
  iteratorType?: BaseType
  depth: number
  parentLoopContext?: LoopContext
}

interface AvailabilityCache {
  upstreamNodes: Set<string>
  availableVariables: UnifiedVariable[]
  loopVariables: UnifiedVariable[]
  timestamp: number
}

interface NodeOutputCache {
  configHash: string
  variables: UnifiedVariable[]
  timestamp: number
}

interface VarStore {
  // Core variable storage
  variables: Map<string, UnifiedVariable>
  environmentVariables: Map<string, EnvVar>
  systemVariables: Map<string, UnifiedVariable>

  // Loop contexts
  loopContexts: Map<string, LoopContext[]>

  // Caches
  nodeOutputCache: Map<string, NodeOutputCache>
  availabilityCache: Map<string, AvailabilityCache>

  // Resource cache for dynamic variable generation
  resources: Map<string, Resource>

  // Actions
  actions: {
    // Initialization
    initializeStore: (workflowData?: any) => void

    // Environment variable CRUD
    setEnvironmentVariable: (envVar: Omit<EnvVar, 'id'> & { id?: string }) => void
    updateEnvironmentVariable: (id: string, updates: Partial<EnvVar>) => void
    deleteEnvironmentVariable: (id: string) => void

    // Node variable management
    updateNodeVariables: (nodeId: string, nodeType: string, config: any) => void
    removeNodeVariables: (nodeId: string) => void

    // Loop context management
    calculateLoopContext: (nodeId: string, nodes: Node[]) => LoopContext[]
    getLoopVariables: (nodeId: string, nodes?: Node[]) => UnifiedVariable[]

    // Availability calculation
    getAvailableVariables: (nodeId: string) => UnifiedVariable[]
    invalidateAvailabilityCache: (nodeId: string) => void
    invalidateDownstreamCache: (nodeId: string) => void
    triggerSync: () => void

    // Variable lookup
    getVariableById: (variableId: string) => UnifiedVariable | undefined

    // ReactFlow sync
    syncWithReactFlow: (nodes: Node[], edges: Edge[]) => void

    // Resource management
    setResources: (resources: Resource[]) => void
    getResource: (resourceId: string) => Resource | undefined
  }
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Flatten a variable and all its nested properties/items for storage
 * After Phase 1-3, we use 'properties' and 'items', not 'children'
 */
function flattenVariableForStorage(variable: UnifiedVariable): UnifiedVariable[] {
  const flattened: UnifiedVariable[] = [variable]

  // Flatten properties object (replaces children array)
  if (variable.properties) {
    Object.values(variable.properties).forEach((prop) => {
      // if (prop) {  // Skip undefined/null properties
      flattened.push(...flattenVariableForStorage(prop))
      // }
    })
  }

  // Flatten array items
  if (variable.items) {
    flattened.push(...flattenVariableForStorage(variable.items))
  }

  return flattened
}

export const useVarStore = create<VarStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      variables: new Map(),
      environmentVariables: new Map(),
      systemVariables: new Map(),
      loopContexts: new Map(),
      nodeOutputCache: new Map(),
      availabilityCache: new Map(),
      resources: new Map(),

      actions: {
        initializeStore: (workflowData?: any) => {
          set((state) => {
            // Initialize system variables
            state.systemVariables.set('sys.currentTime', {
              id: 'sys.currentTime',
              // path: 'currentTime',
              label: 'Current Time',
              type: BaseType.DATETIME,
              description: 'Current date and time',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.userId', {
              id: 'sys.userId',
              // path: 'userId',
              label: 'User ID',
              type: BaseType.STRING,
              description: 'Current user identifier',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.userEmail', {
              id: 'sys.userEmail',
              // path: 'userEmail',
              label: 'User Email',
              type: BaseType.EMAIL,
              description: 'Current user email address',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.userName', {
              id: 'sys.userName',
              // path: 'userName',
              label: 'User Name',
              type: BaseType.STRING,
              description: 'Current user display name',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.organizationId', {
              id: 'sys.organizationId',
              // path: 'organizationId',
              label: 'Organization ID',
              type: BaseType.STRING,
              description: 'Current organization identifier',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.organizationName', {
              id: 'sys.organizationName',
              // path: 'organizationName',
              label: 'Organization Name',
              type: BaseType.STRING,
              description: 'Current organization name',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.workflowId', {
              id: 'sys.workflowId',
              // path: 'workflowId',
              label: 'Workflow ID',
              type: BaseType.STRING,
              description: 'Current workflow identifier',
              category: 'system',
              required: true,
            })

            state.systemVariables.set('sys.executionId', {
              id: 'sys.executionId',
              // path: 'executionId',
              label: 'Execution ID',
              type: BaseType.STRING,
              description: 'Current execution identifier',
              category: 'system',
              required: true,
            })

            // Load environment variables if provided
            if (workflowData?.environmentVariables) {
              workflowData.environmentVariables.forEach((envVar: EnvVar) => {
                state.environmentVariables.set(envVar.id, envVar)
              })
            }
          })
        },

        setEnvironmentVariable: (envVar: Omit<EnvVar, 'id'> & { id?: string }) => {
          set((state) => {
            // Check if a variable with this name already exists
            const existingVariable = Array.from(state.environmentVariables.values()).find(
              (v) => v.name === envVar.name
            )

            if (existingVariable) {
              console.warn(
                `Environment variable with name "${envVar.name}" already exists. Use updateEnvironmentVariable instead.`
              )
              return
            }

            // Generate ID if not provided
            const id = envVar.id || `env.${envVar.name}`
            const environmentVariable: EnvVar = { ...envVar, id }

            state.environmentVariables.set(id, environmentVariable)
            // Invalidate all caches when env vars change
            state.availabilityCache.clear()
          })
          // Mark workflow as dirty to trigger auto-save
          useWorkflowStore.getState().markDirty()
        },

        updateEnvironmentVariable: (id: string, updates: Partial<EnvVar>) => {
          set((state) => {
            const existing = state.environmentVariables.get(id)
            if (existing) {
              state.environmentVariables.set(id, { ...existing, ...updates })
              state.availabilityCache.clear()
            }
          })
          // Mark workflow as dirty to trigger auto-save
          useWorkflowStore.getState().markDirty()
        },

        deleteEnvironmentVariable: (id: string) => {
          set((state) => {
            state.environmentVariables.delete(id)
            state.availabilityCache.clear()
          })
          // Mark workflow as dirty to trigger auto-save
          useWorkflowStore.getState().markDirty()
        },

        updateNodeVariables: (nodeId: string, nodeType: string, configOrData: any) => {
          const configHash = JSON.stringify(configOrData)
          const cached = get().nodeOutputCache.get(nodeId)

          // Check if we need to recalculate
          if (cached && cached.configHash === configHash) {
            console.warn('No changes detected for node:', nodeId, cached.configHash, configHash)
            return
          }

          // Get output variables from node definition
          const nodeDef = unifiedNodeRegistry.getDefinition(nodeType)
          if (!nodeDef?.outputVariables) {
            return
          }

          // Get resources for nodes that need them (resource-trigger, find, crud)
          const resources = Array.from(get().resources.values())
          const resource = configOrData.resourceType
            ? get().resources.get(configOrData.resourceType)
            : undefined

          // Call outputVariables with resources context for resource-dependent nodes
          const outputVars = nodeDef.outputVariables(configOrData, nodeId, resource, resources)

          set((state) => {
            // Remove old variables for this node
            Array.from(state.variables.entries())
              .filter(([_, v]) => getNodeIdFromVariableId(v.id) === nodeId)
              // .filter(([_, v]) => v.nodeId === nodeId)
              .forEach(([id]) => state.variables.delete(id))

            // Add new variables and all their nested children
            outputVars.forEach((variable) => {
              const flattenedVars = flattenVariableForStorage(variable)
              flattenedVars.forEach((flatVar) => {
                state.variables.set(flatVar.id, flatVar)
              })
            })

            // Update cache

            state.nodeOutputCache.set(nodeId, {
              configHash,
              variables: outputVars,
              timestamp: Date.now(),
            })

            // Invalidate downstream availability caches
            get().actions.invalidateDownstreamCache(nodeId)
          })
        },

        removeNodeVariables: (nodeId: string) => {
          set((state) => {
            // Remove variables
            Array.from(state.variables.entries())
              .filter(([_, v]) => getNodeIdFromVariableId(v.id) === nodeId)
              // .filter(([_, v]) => v.nodeId === nodeId)
              .forEach(([id]) => state.variables.delete(id))

            // Clear caches
            state.nodeOutputCache.delete(nodeId)
            state.loopContexts.delete(nodeId)
            state.availabilityCache.delete(nodeId)

            // Invalidate downstream
            get().actions.invalidateDownstreamCache(nodeId)
          })
        },

        calculateLoopContext: (nodeId: string, nodes: Node[]) => {
          const contexts: LoopContext[] = []
          let currentNode = nodes.find((n) => n.id === nodeId)

          while (currentNode?.parentId) {
            const parent = nodes.find((n) => n.id === currentNode!.parentId)

            // DEBUG: Log parent node type check

            // Check both node.type and node.data.type for loop nodes
            const isLoopNode = parent?.data?.type === 'loop'

            if (isLoopNode && parent) {
              contexts.push({
                loopNodeId: parent.id,
                iteratorName: 'item', // Always 'item' now
                iteratorType: BaseType.ANY, // Would be inferred from actual data
                depth: contexts.length + 1, // 1-based depth
              })
            }
            currentNode = parent
          }

          const result = contexts.reverse()

          set((state) => {
            state.loopContexts.set(nodeId, result)
          })

          return result
        },

        getLoopVariables: (nodeId: string, nodes?: Node[]) => {
          const contexts = get().loopContexts.get(nodeId) || []
          const variables: UnifiedVariable[] = []

          contexts.forEach((context, index) => {
            const depth = context.depth || index + 1
            const loopPrefix = depth === 1 ? '' : `loop${depth}.`
            const varPrefix = depth === 1 ? '' : `loop${depth}`

            // Clone the full item structure from the loop's source array
            let itemVariable: Partial<UnifiedVariable> = {
              type: context.iteratorType || BaseType.ANY,
            }

            if (nodes) {
              const loopNode = nodes.find((n: any) => n.id === context.loopNodeId)
              if (loopNode?.data?.itemsSource) {
                const sourceVarId = loopNode.data.itemsSource.replace(/[{}]/g, '')
                const sourceVar = get().variables.get(sourceVarId)

                // Clone FULL items structure and recursively update all nested IDs
                if (sourceVar?.items) {
                  const newBaseId = `${context.loopNodeId}.item`
                  const oldBaseId = `${sourceVarId}[*]`

                  itemVariable = cloneAndRewriteVariableIds(
                    {
                      type: sourceVar.items.type,
                      properties: sourceVar.items.properties,
                      fieldReference: sourceVar.items.fieldReference,
                      resourceId: sourceVar.items.resourceId,
                      items: sourceVar.items.items,
                      enum: sourceVar.items.enum,
                      description: sourceVar.items.description,
                    },
                    newBaseId,
                    oldBaseId
                  )
                }
              }
            }

            // Iterator variable (always 'item' now)
            variables.push({
              id: `${context.loopNodeId}.item`,
              label: depth === 1 ? 'item' : `${varPrefix} item`,
              type: itemVariable.type || BaseType.ANY,
              category: 'node',
              description:
                depth === 1 ? 'Current item in the loop iteration' : `Current item in ${varPrefix}`,
              // Only spread specific fields from itemVariable, not id/label which we set above
              ...(itemVariable.properties && { properties: itemVariable.properties }),
              ...(itemVariable.fieldReference && { fieldReference: itemVariable.fieldReference }),
              ...(itemVariable.resourceId && { resourceId: itemVariable.resourceId }),
              ...(itemVariable.items && { items: itemVariable.items }),
              ...(itemVariable.enum && { enum: itemVariable.enum }),
            })

            // Add loop metadata as flat top-level variables (not nested under 'loop')
            variables.push(
              {
                id: `${context.loopNodeId}.index`,
                label: 'index',
                type: BaseType.NUMBER,
                category: 'node' as const,
                description: 'Zero-based index of current iteration (0, 1, 2, ...)',
              },
              {
                id: `${context.loopNodeId}.count`,
                label: 'count',
                type: BaseType.NUMBER,
                category: 'node' as const,
                description: 'One-based count of current iteration (1, 2, 3, ...)',
              },
              {
                id: `${context.loopNodeId}.total`,
                label: 'total',
                type: BaseType.NUMBER,
                category: 'node' as const,
                description: 'Total number of items in the loop',
              },
              {
                id: `${context.loopNodeId}.isFirst`,
                label: 'isFirst',
                type: BaseType.BOOLEAN,
                category: 'node' as const,
                description: 'True if this is the first iteration',
              },
              {
                id: `${context.loopNodeId}.isLast`,
                label: 'isLast',
                type: BaseType.BOOLEAN,
                category: 'node' as const,
                description: 'True if this is the last iteration',
              }
            )
          })

          return variables
        },

        getAvailableVariables: (nodeId: string) => {
          const cached = get().availabilityCache.get(nodeId)
          if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.availableVariables
          }

          // Cache miss - will be populated by syncWithReactFlow
          // Return empty array to avoid errors
          return []
        },

        invalidateAvailabilityCache: (nodeId: string) => {
          set((state) => {
            state.availabilityCache.delete(nodeId)
          })
        },

        invalidateDownstreamCache: (nodeId: string) => {
          // This requires access to edges to find downstream nodes
          // Will be implemented in syncWithReactFlow
        },

        triggerSync: () => {
          // This will be called by components that need immediate sync
          // The actual sync is handled by the sync provider
          if ((window as any).triggerVarStoreSync) {
            ;(window as any).triggerVarStoreSync()
          }
        },

        getVariableById: (variableId: string) => {
          // First check regular variables
          const variable = get().variables.get(variableId)
          if (variable) return variable

          // Check if it's an environment variable
          if (variableId.startsWith('env.')) {
            const envVar = get().environmentVariables.get(variableId)
            if (envVar) {
              // Convert EnvVar to UnifiedVariable format
              return {
                id: envVar.id || `env.${envVar.name}`,
                path: envVar.name,
                label: envVar.name,
                type: (envVar.type || 'string') as BaseType,
                category: 'environment' as const,
              }
            }
          }

          // Check system variables
          const sysVar = get().systemVariables.get(variableId)
          if (sysVar) return sysVar

          return undefined
        },

        syncWithReactFlow: (nodes: Node[], edges: Edge[]) => {
          const actions = get().actions

          // First, update node variables outside of set()
          const nodeMap = new Map(nodes.map((n) => [n.id, n]))
          const currentCache = get().nodeOutputCache

          // Remove variables for deleted nodes
          for (const [nodeId] of currentCache) {
            if (!nodeMap.has(nodeId)) {
              actions.removeNodeVariables(nodeId)
            }
          }

          // Update variables for existing/new nodes
          for (const node of nodes) {
            const cached = currentCache.get(node.id)
            const configHash = JSON.stringify(node.data)

            // Only update if data changed or not cached
            if (!cached || cached.configHash !== configHash) {
              actions.updateNodeVariables(node.id, node.data.type || '', node.data)
            }

            // Calculate loop context for all nodes
            actions.calculateLoopContext(node.id, nodes)
          }

          // Now update availability cache
          set((state) => {
            // Recalculate available variables for all nodes
            for (const node of nodes) {
              const upstreamNodeIds = getUpstreamNodeIds(node.id, edges, nodes)
              const upstreamVars: UnifiedVariable[] = []

              // Get loop contexts to check if this node is inside any loops
              const nodeLoopContexts = get().loopContexts.get(node.id) || []
              const parentLoopIds = new Set(nodeLoopContexts.map((ctx) => ctx.loopNodeId))

              // Collect variables from upstream nodes (including all nested children)
              upstreamNodeIds.forEach((upstreamId) => {
                const nodeVars = get().nodeOutputCache.get(upstreamId)?.variables || []
                nodeVars.forEach((variable) => {
                  const flattenedVars = flattenVariableForStorage(variable)

                  // Filter: If current node is INSIDE a loop, don't include that loop's OUTPUT variables
                  // (Loop output variables like 'results', 'totalIterations' are only available AFTER loop completes)
                  const beforeFilterCount = flattenedVars.length
                  const filteredVars = flattenedVars.filter((v) => {
                    const varNodeId = getNodeIdFromVariableId(v.id)

                    // If this variable belongs to a loop that contains the current node,
                    // skip it (we'll add loop iteration variables separately via getLoopVariables)
                    if (parentLoopIds.has(varNodeId)) {
                      return false
                    }

                    return true
                  })

                  upstreamVars.push(...filteredVars)
                })
              })

              // Add loop variables if in loop (pass nodes for type inference)
              const loopVars = actions.getLoopVariables(node.id, nodes)

              // Flatten loop variables for both storage AND availability cache
              // This ensures nested properties like loop.item.firstName are available for validation
              const flattenedLoopVars: UnifiedVariable[] = []

              loopVars.forEach((loopVar) => {
                const flattenedVars = flattenVariableForStorage(loopVar)
                flattenedVars.forEach((flatVar) => {
                  state.variables.set(flatVar.id, flatVar)
                  flattenedLoopVars.push(flatVar) // ✅ Collect flattened for availability
                })
              })

              // Add environment and system variables
              const envVars = Array.from(state.environmentVariables.values()).map((env) => ({
                id: env.id || `env.${env.name}`,
                path: env.name,
                label: env.name,
                type: (env.type || 'string') as BaseType,
                category: 'environment' as const,
              }))

              const sysVars = Array.from(state.systemVariables.values())

              // Combine all variables (use flattened loop vars for consistency)
              const allVars = [...upstreamVars, ...flattenedLoopVars, ...envVars, ...sysVars]

              // Update cache
              state.availabilityCache.set(node.id, {
                upstreamNodes: upstreamNodeIds,
                availableVariables: allVars,
                loopVariables: flattenedLoopVars, // ✅ Store flattened vars
                timestamp: Date.now(),
              })
            }
          })
        },

        // Resource management - for dynamic variable generation in resource-dependent nodes
        setResources: (resources: Resource[]) => {
          set((state) => {
            state.resources.clear()
            resources.forEach((resource) => {
              state.resources.set(resource.id, resource)
            })
          })
          // Trigger resync to regenerate variables with new resources
          get().actions.triggerSync()
        },

        getResource: (resourceId: string) => {
          return get().resources.get(resourceId)
        },
      },
    }))
  )
)
