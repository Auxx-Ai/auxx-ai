// apps/web/src/components/workflow/viewer/hooks/use-workflow-viewer.ts
'use client'
import { useCallback, useEffect, useState } from 'react'
import type { Viewport } from '@xyflow/react'
import type { FlowEdge, FlowNode } from '../../types'
import { initializeWorkflow } from '../../utils/workflow-initializer'
import { API_URL } from '@auxx/config/client'

/** Sanitized environment variable from public API */
export interface SanitizedEnvVar {
  id: string
  name: string
  type: string
}

/**
 * Pre-loaded workflow data for data mode
 */
export interface WorkflowViewerData {
  name: string
  graph: {
    nodes: FlowNode[]
    edges: FlowEdge[]
    viewport?: Viewport | null
  }
  envVars?: SanitizedEnvVar[]
}

/**
 * Options for the workflow viewer hook
 */
interface UseWorkflowViewerOptions {
  /** Workflow ID to fetch (fetch mode) */
  workflowId?: string
  /** Pre-loaded workflow data (data mode) */
  workflow?: WorkflowViewerData
  initialViewport?: Viewport
}

/**
 * Return type for the workflow viewer hook
 */
interface UseWorkflowViewerReturn {
  workflowName: string | null
  nodes: FlowNode[] | null
  edges: FlowEdge[] | null
  viewport: Viewport | null
  environmentVariables: SanitizedEnvVar[] | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Hook to fetch or load public workflow data for the viewer
 * Supports two modes:
 * - Fetch mode: Pass workflowId to fetch from API
 * - Data mode: Pass workflow object with pre-loaded data
 */
export const useWorkflowViewer = ({
  workflowId,
  workflow,
  initialViewport,
}: UseWorkflowViewerOptions): UseWorkflowViewerReturn => {
  const [workflowName, setWorkflowName] = useState<string | null>(null)
  const [nodes, setNodes] = useState<FlowNode[] | null>(null)
  const [edges, setEdges] = useState<FlowEdge[] | null>(null)
  const [viewport, setViewport] = useState<Viewport | null>(initialViewport || null)
  const [environmentVariables, setEnvironmentVariables] = useState<SanitizedEnvVar[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const loadWorkflow = useCallback(async () => {
    // Data mode: use pre-loaded workflow data
    if (workflow) {
      setWorkflowName(workflow.name)
      setEnvironmentVariables(workflow.envVars || [])

      if (workflow.graph) {
        // Initialize workflow with proper metadata
        const { nodes: initializedNodes, edges: initializedEdges } = initializeWorkflow(
          workflow.graph.nodes || [],
          workflow.graph.edges || []
        )
        setNodes(initializedNodes)
        setEdges(initializedEdges)
        setViewport(initialViewport || workflow.graph.viewport || null)
      } else {
        setNodes([])
        setEdges([])
      }

      setIsLoading(false)
      return
    }

    // Fetch mode: require workflowId
    if (!workflowId) {
      setError(new Error('Either workflowId or workflow data is required'))
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Fetch from Hono API endpoint
      const response = await fetch(`${API_URL}/api/v1/workflows/public/${workflowId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error?.message || `Failed to load workflow (${response.status})`)
      }

      const { success, data, error: apiError } = await response.json()

      if (!success) {
        throw new Error(apiError?.message || 'Failed to load workflow')
      }

      setWorkflowName(data.name)
      setEnvironmentVariables(data.envVars || [])

      // Process nodes and edges
      if (data.graph) {
        const { nodes: graphNodes, edges: graphEdges, viewport: graphViewport } = data.graph

        // Initialize workflow with proper metadata
        const { nodes: initializedNodes, edges: initializedEdges } = initializeWorkflow(
          graphNodes || [],
          graphEdges || []
        )

        setNodes(initializedNodes)
        setEdges(initializedEdges)
        setViewport(initialViewport || graphViewport || null)
      } else {
        setNodes([])
        setEdges([])
      }
    } catch (err) {
      console.error('[WorkflowViewer] Error loading workflow:', err)
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [workflowId, workflow, initialViewport])

  useEffect(() => {
    loadWorkflow()
  }, [loadWorkflow])

  return {
    workflowName,
    nodes,
    edges,
    viewport,
    environmentVariables,
    isLoading,
    error,
    refetch: loadWorkflow,
  }
}
