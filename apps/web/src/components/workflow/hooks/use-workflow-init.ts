// apps/web/src/components/workflow/hooks/use-workflow-init.ts

import type { Viewport } from '@xyflow/react'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { useWorkflowStore, type WorkflowMetadata } from '../store'
import { useVarStore } from '../store/use-var-store'
import type { EnvVar, FetchWorkflowResponse, FlowEdge, FlowNode } from '../types'
import { initializeWorkflow } from '../utils/workflow-initializer'

/**
 * `FetchWorkflowResponse.graph.nodes` in `types/core.ts` resolves to the DOM
 * `Node` — that file imports `Edge`/`Viewport` from React Flow but not `Node`,
 * so the global wins. The route really returns canvas nodes; correct it here
 * rather than trusting the declared shape.
 */
export type FetchedWorkflow = Omit<FetchWorkflowResponse, 'graph'> & {
  graph: { nodes: FlowNode[]; edges: FlowEdge[]; viewport: Viewport }
}

/**
 * Apply a fetched workflow response to the module-level stores and produce the
 * canvas-ready graph — THE graph→store mapping. Shared by the initial load
 * below and the `workflow:draft-updated` realtime rehydrate
 * (`use-workflow-draft-realtime.ts`) so a second mapping never drifts.
 *
 * Marks the store clean (`isDirty: false`) — callers only run this against a
 * server draft that IS the canvas's new truth. Does not apply the viewport;
 * callers decide (initial load seeds it, the realtime rehydrate keeps the
 * user's current view).
 */
export function applyFetchedWorkflow(workflow: FetchedWorkflow): {
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewport: Viewport | null
  metadata: WorkflowMetadata
} {
  const metadata: WorkflowMetadata = {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || '',
    version: workflow.version,
    lastModified: new Date(workflow.updatedAt),
    createdBy: workflow.createdBy,
    tags: [],
  }
  // Update workflow store — `workflow` carries the fresh `graphHash`, which is
  // the CAS token every subsequent canvas save posts as `expectedGraphHash`.
  useWorkflowStore.setState({
    workflow: workflow as any,
    workflowId: workflow.workflowId, // Use the actual workflow ID, not the WorkflowApp ID
    metadata,
    workflowAppId: workflow.workflowAppId,
    hasPublishedVersion: !!(workflow as any).hasPublishedVersion,
    isDirty: false,
    isLoading: false,
  })
  // Process environment variables if present
  if (workflow.envVars && Array.isArray(workflow.envVars)) {
    const varStore = useVarStore.getState()
    varStore.actions.initializeStore({
      environmentVariables: workflow.envVars.map((envVar: any) => ({
        id: envVar.id || `env.${envVar.name}`,
        name: envVar.name,
        value: envVar.value,
        type: envVar.type || 'string',
        description: envVar.description,
      })),
    })
  }
  if (workflow.graph) {
    const { nodes: graphNodes, edges: graphEdges, viewport: graphViewport } = workflow.graph
    const { nodes, edges } = initializeWorkflow(graphNodes || [], graphEdges || [])
    return { nodes, edges, viewport: graphViewport || null, metadata }
  }
  return { nodes: [], edges: [], viewport: null, metadata }
}

interface UseWorkflowInitOptions {
  workflowId?: string
  workflowAppId?: string
}
interface UseWorkflowInitReturn {
  workflowData: FetchWorkflowResponse | null
  modelData: any | null
  environmentVariables: EnvVar[] | null
  nodes: FlowNode[] | null
  edges: FlowEdge[] | null
  viewport: Viewport | null
  isLoading: boolean
  isLoadingWorkflow: boolean
  isLoadingModels: boolean
  error: Error | null
  refetch: () => Promise<void>
}
/**
 * Hook to initialize workflow data, model responses, and environment variables
 */
export const useWorkflowInit = (options?: UseWorkflowInitOptions): UseWorkflowInitReturn => {
  const params = useParams()
  const workflowId = options?.workflowId || (params?.workflowId as string)

  // Note: We don't need store instances here since we'll use the static methods
  // State for workflow data
  const [workflowData, setWorkflowData] = useState<any | null>(null)
  const [environmentVariables, setEnvironmentVariables] = useState<EnvVar[] | null>(null)
  const [nodes, setNodes] = useState<FlowNode[] | null>(null)
  const [edges, setEdges] = useState<FlowEdge[] | null>(null)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  // Loading states
  const [isLoadingWorkflow, setIsLoadingWorkflow] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  // Use tRPC for model data instead of REST
  const { data: modelData, isLoading: isLoadingModels } =
    api.aiIntegration.getUnifiedModelData.useQuery(
      { includeDefaults: true },
      {
        staleTime: ORG_STATIC_STALE_TIME,
        // cacheTime: 10 * 60 * 1000, // 10 minute background cache
      }
    )
  /**
   * Fetch workflow data from API
   */
  const fetchWorkflow = useCallback(async () => {
    // Special case for new workflows
    if (!workflowId || workflowId === 'new') {
      useWorkflowStore.setState({
        workflow: null,
        workflowId: null,
        metadata: null,
        isDirty: false,
        isLoading: false,
        error: null,
      })
      setWorkflowData(null)
      setNodes([])
      setEdges([])
      setViewport(null)
      setIsLoadingWorkflow(false)
      return
    }
    setIsLoadingWorkflow(true)
    setError(null)
    try {
      const response = await fetch(`/api/workflows/${workflowId}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to load workflow')
      }
      const workflow = (await response.json()) as FetchedWorkflow
      setWorkflowData(workflow)
      // Apply to stores + build the canvas graph — shared with the realtime
      // rehydrate, see `applyFetchedWorkflow` above.
      const applied = applyFetchedWorkflow(workflow)
      // Set environment variables for backward compatibility
      if (workflow.envVars && Array.isArray(workflow.envVars)) {
        setEnvironmentVariables(workflow.envVars)
      }
      console.log('Workflow data loaded:', workflow)
      // Note: App metadata (appId, installationId, blockId) is parsed directly
      // in AppWorkflowNode from data.type when needed.
      // StandardNode has a fallback to use AppWorkflowNode for unregistered app node types.
      setNodes(applied.nodes)
      setEdges(applied.edges)
      setViewport(applied.viewport)
      // Variable syncing now happens automatically via VarStoreSyncProvider
      // The ReactFlow subscription will handle node variable updates
    } catch (err) {
      console.error('Error loading workflow:', err)
      setError(err as Error)
      useWorkflowStore.setState({
        isLoading: false,
        error: `Failed to load workflow: ${(err as Error).message}`,
        workflow: null,
        workflowId: null,
      })
    } finally {
      setIsLoadingWorkflow(false)
    }
  }, [workflowId])
  // Model data is now fetched via tRPC query above - no need for separate function
  /**
   * Refetch all data
   */
  const refetch = useCallback(async () => {
    await fetchWorkflow()
    // Model data will refetch automatically via tRPC
  }, [fetchWorkflow])
  /**
   * Initialize on mount and when workflowId changes
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: options.workflowAppId is intentionally read inside the effect
  useEffect(() => {
    // Set workflow app ID if provided
    if (options?.workflowAppId) {
      useWorkflowStore.setState({ workflowAppId: options.workflowAppId })
    }
    // Fetch workflow data (model data is handled by tRPC query above)
    fetchWorkflow()
  }, [fetchWorkflow])
  /**
   * Sync modelData to workflow store when it updates
   */
  useEffect(() => {
    if (modelData) {
      useWorkflowStore.setState({ modelData })
    }
  }, [modelData])
  /**
   * Update draft metadata when workflow data changes
   */
  useEffect(() => {
    if (workflowData) {
      if (workflowData.updated_at) {
        // useWorkflowStore.getState().setDraftUpdatedAt(workflowData.updated_at)
      }
    }
  }, [workflowData])
  return {
    workflowData,
    modelData,
    environmentVariables,
    nodes,
    edges,
    viewport,
    isLoading: isLoadingWorkflow || isLoadingModels,
    isLoadingWorkflow,
    isLoadingModels,
    error,
    refetch,
  }
}
