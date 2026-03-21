// apps/web/src/components/workflow/store/use-var-store.ts

import type { Resource } from '@auxx/lib/resources/client'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { BaseType, type UnifiedVariable } from '~/components/workflow/types'
import { cloneAndRewriteVariableIds } from '~/components/workflow/utils/variable-cloning'
import { getNodeIdFromVariableId } from '~/components/workflow/utils/variable-utils'
import type { EnvVar } from '../types'
import {
  buildVariableIndex,
  computeNodeOutputs,
  convertEnvVarToUnified,
  findVariableInTree,
  flattenVariableForStorage,
  type NodeOutput,
} from './var-availability'
import {
  buildDownstreamMap,
  buildUpstreamMap,
  computeLoopAncestry,
  type EdgeMeta,
  type NodeMeta,
  topologicalSort,
} from './var-graph'
import { useWorkflowStore } from './workflow-store'

export interface LoopContext {
  loopNodeId: string
  iteratorName: string
  iteratorType?: BaseType
  depth: number
  parentLoopContext?: LoopContext
}

interface AvailabilityEntry {
  variables: UnifiedVariable[]
}

interface VarStoreState {
  // === Source of truth ===
  nodeOutputs: Map<string, NodeOutput>
  graph: { nodes: NodeMeta[]; edges: EdgeMeta[] }
  environmentVariables: Map<string, EnvVar>
  systemVariables: Map<string, UnifiedVariable>
  resources: Map<string, Resource>

  // === Derived (computed on write, cached) ===
  upstreamMap: Map<string, Set<string>>
  downstreamMap: Map<string, Set<string>>
  loopAncestry: Map<string, LoopContext[]>
  availability: Map<string, AvailabilityEntry>
  variableIndex: Map<string, UnifiedVariable>

  // Actions
  actions: {
    initializeStore: (workflowData?: any) => void
    updateGraph: (nodes: NodeMeta[], edges: EdgeMeta[]) => void
    updateNodeData: (nodeId: string, type: string, data: any) => void
    handleRegistryUpdate: (changedIds: string[]) => void
    setEnvironmentVariable: (envVar: Omit<EnvVar, 'id'> & { id?: string }) => void
    updateEnvironmentVariable: (id: string, updates: Partial<EnvVar>) => void
    deleteEnvironmentVariable: (id: string) => void
    setResources: (resources: Resource[]) => void
    getResource: (resourceId: string) => Resource | undefined
    getVariableById: (variableId: string) => UnifiedVariable | undefined
    getAvailableVariables: (nodeId: string) => UnifiedVariable[]
    // Legacy compat — no-op, sync is now event-driven
    triggerSync: () => void
    syncWithReactFlow: (nodes: any[], edges: any[]) => void
  }
}

/** Stable empty arrays to avoid new references (Zustand v5 safety) */
const EMPTY_VARS: UnifiedVariable[] = []
const EMPTY_LOOP_CONTEXTS: LoopContext[] = []

/**
 * Compute loop iteration variables for a node.
 * Uses resolveVariable to get source array structure.
 */
function computeLoopVariables(
  nodeId: string,
  loopAncestry: Map<string, LoopContext[]>,
  graph: { nodes: NodeMeta[] },
  resolveVariable: (variableId: string) => UnifiedVariable | undefined
): UnifiedVariable[] {
  const contexts = loopAncestry.get(nodeId) || EMPTY_LOOP_CONTEXTS
  const variables: UnifiedVariable[] = []

  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index]
    const depth = context.depth || index + 1
    const varPrefix = depth === 1 ? '' : `loop${depth}`

    // Resolve the source array's item structure
    let itemVariable: Partial<UnifiedVariable> = {
      type: context.iteratorType || BaseType.ANY,
    }

    const loopNode = graph.nodes.find((n) => n.id === context.loopNodeId)
    if (loopNode?.data?.itemsSource) {
      const sourceVarId = loopNode.data.itemsSource.replace(/[{}]/g, '')
      const sourceVar = resolveVariable(sourceVarId)

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

    // Iterator variable
    variables.push({
      id: `${context.loopNodeId}.item`,
      label: depth === 1 ? 'item' : `${varPrefix} item`,
      type: itemVariable.type || BaseType.ANY,
      category: 'node',
      description:
        depth === 1 ? 'Current item in the loop iteration' : `Current item in ${varPrefix}`,
      ...(itemVariable.properties && { properties: itemVariable.properties }),
      ...(itemVariable.fieldReference && { fieldReference: itemVariable.fieldReference }),
      ...(itemVariable.resourceId && { resourceId: itemVariable.resourceId }),
      ...(itemVariable.items && { items: itemVariable.items }),
      ...(itemVariable.enum && { enum: itemVariable.enum }),
    })

    // Loop metadata variables
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
  }

  return variables
}

/**
 * Compute availability for a single node.
 * Collects upstream outputs + loop variables + env + sys.
 */
function computeNodeAvailability(
  nodeId: string,
  nodeOutputs: Map<string, NodeOutput>,
  upstreamMap: Map<string, Set<string>>,
  loopAncestry: Map<string, LoopContext[]>,
  graph: { nodes: NodeMeta[] },
  environmentVariables: Map<string, EnvVar>,
  systemVariables: Map<string, UnifiedVariable>,
  resolveVariable: (variableId: string) => UnifiedVariable | undefined
): UnifiedVariable[] {
  const upstreamNodeIds = upstreamMap.get(nodeId) || new Set()
  const nodeLoopContexts = loopAncestry.get(nodeId) || EMPTY_LOOP_CONTEXTS
  const parentLoopIds = new Set(nodeLoopContexts.map((ctx) => ctx.loopNodeId))

  const allVars: UnifiedVariable[] = []

  // Collect upstream node output variables (flattened)
  for (const upstreamId of upstreamNodeIds) {
    const nodeVars = nodeOutputs.get(upstreamId)?.variables || EMPTY_VARS
    for (const variable of nodeVars) {
      const flattenedVars = flattenVariableForStorage(variable)
      for (const v of flattenedVars) {
        const varNodeId = getNodeIdFromVariableId(v.id)
        // Filter out parent loop output variables (loop iteration vars added separately)
        if (!parentLoopIds.has(varNodeId)) {
          allVars.push(v)
        }
      }
    }
  }

  // Add loop iteration variables
  const loopVars = computeLoopVariables(nodeId, loopAncestry, graph, resolveVariable)
  for (const loopVar of loopVars) {
    const flattenedVars = flattenVariableForStorage(loopVar)
    allVars.push(...flattenedVars)
  }

  // Add environment variables
  for (const [_id, envVar] of environmentVariables) {
    allVars.push(convertEnvVarToUnified(envVar))
  }

  // Add system variables
  for (const [_id, sysVar] of systemVariables) {
    allVars.push(sysVar)
  }

  return allVars
}

export const useVarStore = create<VarStoreState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      nodeOutputs: new Map([] as [string, NodeOutput][]),
      graph: { nodes: [] as NodeMeta[], edges: [] as EdgeMeta[] },
      environmentVariables: new Map([] as [string, EnvVar][]),
      systemVariables: new Map([] as [string, UnifiedVariable][]),
      resources: new Map([] as [string, Resource][]),
      upstreamMap: new Map([] as [string, Set<string>][]),
      downstreamMap: new Map([] as [string, Set<string>][]),
      loopAncestry: new Map([] as [string, LoopContext[]][]),
      availability: new Map([] as [string, AvailabilityEntry][]),
      variableIndex: new Map([] as [string, UnifiedVariable][]),

      actions: {
        initializeStore: (workflowData?: any) => {
          set((state) => {
            // Initialize system variables
            const sysVars: Array<[string, UnifiedVariable]> = [
              [
                'sys.currentTime',
                {
                  id: 'sys.currentTime',
                  nodeId: 'sys',
                  label: 'Current Time',
                  type: BaseType.DATETIME,
                  description: 'Current date and time',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.userId',
                {
                  id: 'sys.userId',
                  nodeId: 'sys',
                  label: 'User ID',
                  type: BaseType.STRING,
                  description: 'Current user identifier',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.userEmail',
                {
                  id: 'sys.userEmail',
                  nodeId: 'sys',
                  label: 'User Email',
                  type: BaseType.EMAIL,
                  description: 'Current user email address',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.userName',
                {
                  id: 'sys.userName',
                  nodeId: 'sys',
                  label: 'User Name',
                  type: BaseType.STRING,
                  description: 'Current user display name',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.organizationId',
                {
                  id: 'sys.organizationId',
                  nodeId: 'sys',
                  label: 'Organization ID',
                  type: BaseType.STRING,
                  description: 'Current organization identifier',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.organizationName',
                {
                  id: 'sys.organizationName',
                  nodeId: 'sys',
                  label: 'Organization Name',
                  type: BaseType.STRING,
                  description: 'Current organization name',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.workflowId',
                {
                  id: 'sys.workflowId',
                  nodeId: 'sys',
                  label: 'Workflow ID',
                  type: BaseType.STRING,
                  description: 'Current workflow identifier',
                  category: 'system',
                  required: true,
                },
              ],
              [
                'sys.executionId',
                {
                  id: 'sys.executionId',
                  nodeId: 'sys',
                  label: 'Execution ID',
                  type: BaseType.STRING,
                  description: 'Current execution identifier',
                  category: 'system',
                  required: true,
                },
              ],
            ]
            state.systemVariables = new Map(sysVars)

            // Clear stale env vars
            state.environmentVariables.clear()

            // Load environment variables if provided
            if (workflowData?.environmentVariables) {
              for (const envVar of workflowData.environmentVariables) {
                state.environmentVariables.set(envVar.id, envVar)
              }
            }
          })
        },

        updateGraph: (nodes: NodeMeta[], edges: EdgeMeta[]) => {
          const state = get()

          // Detect structural changes (nodes added/removed, edges changed, parentIds changed)
          const prevNodeIds = new Set(state.graph.nodes.map((n) => n.id))
          const newNodeIds = new Set(nodes.map((n) => n.id))
          const nodeMap = new Map(nodes.map((n) => [n.id, n]))

          const nodesChanged =
            prevNodeIds.size !== newNodeIds.size ||
            [...prevNodeIds].some((id) => !newNodeIds.has(id)) ||
            [...newNodeIds].some((id) => !prevNodeIds.has(id))

          const edgesChanged =
            state.graph.edges.length !== edges.length ||
            state.graph.edges.some(
              (e, i) =>
                e.id !== edges[i]?.id ||
                e.source !== edges[i]?.source ||
                e.target !== edges[i]?.target
            )

          const parentIdsChanged = nodes.some((n) => {
            const prev = state.graph.nodes.find((p) => p.id === n.id)
            return prev && prev.parentId !== n.parentId
          })

          const structureChanged = nodesChanged || edgesChanged

          // Rebuild graph maps if structure changed
          let upstreamMap = state.upstreamMap
          let downstreamMap = state.downstreamMap
          if (structureChanged) {
            upstreamMap = buildUpstreamMap(edges, nodes)
            downstreamMap = buildDownstreamMap(upstreamMap)
          }

          // Rebuild loop ancestry if parentIds or structure changed
          let loopAncestry = state.loopAncestry
          if (structureChanged || parentIdsChanged) {
            loopAncestry = computeLoopAncestry(nodes)
          }

          // Compute outputs in topological order for changed nodes
          const topoOrder = topologicalSort(nodes, edges)
          const newNodeOutputs = new Map(state.nodeOutputs)

          // Remove deleted nodes
          for (const [nodeId] of state.nodeOutputs) {
            if (!newNodeIds.has(nodeId)) {
              newNodeOutputs.delete(nodeId)
            }
          }

          // Build resolver that reads from already-computed outputs
          const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
            const sourceNodeId = getNodeIdFromVariableId(variableId)
            const outputs = newNodeOutputs.get(sourceNodeId)
            if (!outputs) return undefined
            return findVariableInTree(outputs.variables, variableId)
          }

          // Compute outputs in topo order for nodes whose data changed
          let outputsChanged = false
          for (const nodeId of topoOrder) {
            const node = nodeMap.get(nodeId)
            if (!node) continue

            const existing = newNodeOutputs.get(nodeId)
            // Skip if data reference hasn't changed (Immer structural sharing)
            if (existing && existing.dataRef === node.data) continue

            const nodeType = node.data?.type || node.type || ''
            const outputs = computeNodeOutputs(
              nodeId,
              nodeType,
              node.data,
              state.resources,
              resolveVariable
            )

            newNodeOutputs.set(nodeId, {
              type: nodeType,
              dataRef: node.data,
              variables: outputs,
            })
            outputsChanged = true
          }

          // Skip availability + index recomputation if nothing changed
          if (!outputsChanged && !structureChanged && !parentIdsChanged) {
            set((s) => {
              s.graph = { nodes, edges }
            })
            return
          }

          // Compute availability for all nodes
          const newAvailability = new Map<string, AvailabilityEntry>()
          for (const node of nodes) {
            const vars = computeNodeAvailability(
              node.id,
              newNodeOutputs,
              upstreamMap,
              loopAncestry,
              { nodes },
              state.environmentVariables,
              state.systemVariables,
              resolveVariable
            )
            newAvailability.set(node.id, { variables: vars })
          }

          // Rebuild variable index
          const newVariableIndex = buildVariableIndex(
            newNodeOutputs,
            state.environmentVariables,
            state.systemVariables
          )

          // Also add loop iteration variables to the index
          for (const node of nodes) {
            const loopVars = computeLoopVariables(node.id, loopAncestry, { nodes }, resolveVariable)
            for (const loopVar of loopVars) {
              for (const flat of flattenVariableForStorage(loopVar)) {
                newVariableIndex.set(flat.id, flat)
              }
            }
          }

          set((s) => {
            s.graph = { nodes, edges }
            s.nodeOutputs = newNodeOutputs
            s.upstreamMap = upstreamMap
            s.downstreamMap = downstreamMap
            s.loopAncestry = loopAncestry
            s.availability = newAvailability
            s.variableIndex = newVariableIndex
          })
        },

        updateNodeData: (nodeId: string, type: string, data: any) => {
          const state = get()
          const existing = state.nodeOutputs.get(nodeId)
          if (existing && existing.dataRef === data) return

          const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
            const sourceNodeId = getNodeIdFromVariableId(variableId)
            const outputs = state.nodeOutputs.get(sourceNodeId)
            if (!outputs) return undefined
            return findVariableInTree(outputs.variables, variableId)
          }

          const outputs = computeNodeOutputs(nodeId, type, data, state.resources, resolveVariable)

          set((s) => {
            s.nodeOutputs.set(nodeId, { type, dataRef: data, variables: outputs })

            // Cascade: recompute downstream nodes that might depend on this output
            const downstream = s.downstreamMap.get(nodeId) || new Set()
            for (const downstreamId of downstream) {
              const downNode = s.graph.nodes.find((n) => n.id === downstreamId)
              if (!downNode) continue

              const downType = downNode.data?.type || downNode.type || ''
              const downOutputs = computeNodeOutputs(
                downstreamId,
                downType,
                downNode.data,
                s.resources,
                resolveVariable
              )
              s.nodeOutputs.set(downstreamId, {
                type: downType,
                dataRef: downNode.data,
                variables: downOutputs,
              })
            }

            // Recompute availability for affected nodes
            const affectedNodes = new Set([nodeId, ...downstream])
            for (const affectedId of affectedNodes) {
              const vars = computeNodeAvailability(
                affectedId,
                s.nodeOutputs,
                s.upstreamMap,
                s.loopAncestry,
                s.graph,
                s.environmentVariables,
                s.systemVariables,
                resolveVariable
              )
              s.availability.set(affectedId, { variables: vars })
            }

            // Rebuild variable index
            s.variableIndex = buildVariableIndex(
              s.nodeOutputs,
              s.environmentVariables,
              s.systemVariables
            )
          })
        },

        handleRegistryUpdate: (changedIds: string[]) => {
          const state = get()
          const changedSet = new Set(changedIds)

          // Find ALL nodes with matching types (review finding #4: not just empty)
          const affectedNodeIds = state.graph.nodes
            .filter((n) => {
              const nodeType = n.data?.type || n.type || ''
              return changedSet.has(nodeType)
            })
            .map((n) => n.id)

          if (affectedNodeIds.length === 0) return

          // Clear cached outputs for affected nodes so updateGraph doesn't
          // skip them due to dataRef equality (same pattern as setResources)
          set((s) => {
            for (const nodeId of affectedNodeIds) {
              s.nodeOutputs.delete(nodeId)
            }
          })

          // Recompute in topo order via full updateGraph
          get().actions.updateGraph(state.graph.nodes, state.graph.edges)
        },

        setEnvironmentVariable: (envVar: Omit<EnvVar, 'id'> & { id?: string }) => {
          set((state) => {
            // Check for duplicate name
            const existingVariable = Array.from(state.environmentVariables.values()).find(
              (v) => v.name === envVar.name
            )
            if (existingVariable) {
              console.warn(
                `Environment variable with name "${envVar.name}" already exists. Use updateEnvironmentVariable instead.`
              )
              return
            }

            const id = envVar.id || `env.${envVar.name}`
            const environmentVariable: EnvVar = { ...envVar, id }
            state.environmentVariables.set(id, environmentVariable)

            // Recompute all availability (env vars are global)
            const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
              const sourceNodeId = getNodeIdFromVariableId(variableId)
              const outputs = state.nodeOutputs.get(sourceNodeId)
              if (!outputs) return undefined
              return findVariableInTree(outputs.variables, variableId)
            }

            for (const node of state.graph.nodes) {
              const vars = computeNodeAvailability(
                node.id,
                state.nodeOutputs,
                state.upstreamMap,
                state.loopAncestry,
                state.graph,
                state.environmentVariables,
                state.systemVariables,
                resolveVariable
              )
              state.availability.set(node.id, { variables: vars })
            }

            // Rebuild variable index
            state.variableIndex = buildVariableIndex(
              state.nodeOutputs,
              state.environmentVariables,
              state.systemVariables
            )
          })
          useWorkflowStore.getState().markDirty()
        },

        updateEnvironmentVariable: (id: string, updates: Partial<EnvVar>) => {
          set((state) => {
            const existing = state.environmentVariables.get(id)
            if (!existing) return
            state.environmentVariables.set(id, { ...existing, ...updates })

            // Recompute all availability
            const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
              const sourceNodeId = getNodeIdFromVariableId(variableId)
              const outputs = state.nodeOutputs.get(sourceNodeId)
              if (!outputs) return undefined
              return findVariableInTree(outputs.variables, variableId)
            }

            for (const node of state.graph.nodes) {
              const vars = computeNodeAvailability(
                node.id,
                state.nodeOutputs,
                state.upstreamMap,
                state.loopAncestry,
                state.graph,
                state.environmentVariables,
                state.systemVariables,
                resolveVariable
              )
              state.availability.set(node.id, { variables: vars })
            }

            state.variableIndex = buildVariableIndex(
              state.nodeOutputs,
              state.environmentVariables,
              state.systemVariables
            )
          })
          useWorkflowStore.getState().markDirty()
        },

        deleteEnvironmentVariable: (id: string) => {
          set((state) => {
            state.environmentVariables.delete(id)

            // Recompute all availability
            const resolveVariable = (variableId: string): UnifiedVariable | undefined => {
              const sourceNodeId = getNodeIdFromVariableId(variableId)
              const outputs = state.nodeOutputs.get(sourceNodeId)
              if (!outputs) return undefined
              return findVariableInTree(outputs.variables, variableId)
            }

            for (const node of state.graph.nodes) {
              const vars = computeNodeAvailability(
                node.id,
                state.nodeOutputs,
                state.upstreamMap,
                state.loopAncestry,
                state.graph,
                state.environmentVariables,
                state.systemVariables,
                resolveVariable
              )
              state.availability.set(node.id, { variables: vars })
            }

            state.variableIndex = buildVariableIndex(
              state.nodeOutputs,
              state.environmentVariables,
              state.systemVariables
            )
          })
          useWorkflowStore.getState().markDirty()
        },

        setResources: (resources: Resource[]) => {
          set((state) => {
            state.resources.clear()
            for (const resource of resources) {
              // Store by id, apiSlug, entityType, and entityDefinitionId for flexible lookup
              state.resources.set(resource.id, resource)
              if (resource.apiSlug) {
                state.resources.set(resource.apiSlug, resource)
              }
              if (resource.entityType) {
                state.resources.set(resource.entityType, resource)
              }
              // Index by entityDefinitionId if different from id
              if (resource.entityDefinitionId && resource.entityDefinitionId !== resource.id) {
                state.resources.set(resource.entityDefinitionId, resource)
              }
            }
            // Clear nodeOutputs so updateGraph recomputes all nodes
            // (data refs haven't changed, but resources have)
            state.nodeOutputs.clear()
          })
          // Trigger full graph recomputation with new resources
          const state = get()
          if (state.graph.nodes.length > 0) {
            get().actions.updateGraph(state.graph.nodes, state.graph.edges)
          }
        },

        getResource: (resourceId: string) => {
          return get().resources.get(resourceId)
        },

        getVariableById: (variableId: string) => {
          if (!variableId) return undefined

          // Check environment variables
          if (variableId.startsWith('env.')) {
            const envVar = get().environmentVariables.get(variableId)
            if (envVar) return convertEnvVarToUnified(envVar)
          }

          // Check system variables
          if (variableId.startsWith('sys.')) {
            return get().systemVariables.get(variableId)
          }

          // Check variable index (includes node outputs + loop vars)
          return get().variableIndex.get(variableId)
        },

        getAvailableVariables: (nodeId: string) => {
          return get().availability.get(nodeId)?.variables ?? EMPTY_VARS
        },

        // Legacy compat — no-op, sync is now event-driven
        triggerSync: () => {},

        // Legacy compat — delegates to updateGraph with NodeMeta conversion
        syncWithReactFlow: (nodes: any[], edges: any[]) => {
          const nodeMetas: NodeMeta[] = nodes.map((n) => ({
            id: n.id,
            type: n.data?.type || n.type || '',
            data: n.data,
            parentId: n.parentId,
          }))
          const edgeMetas: EdgeMeta[] = edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            data: e.data,
          }))
          get().actions.updateGraph(nodeMetas, edgeMetas)
        },
      },
    }))
  )
)
