// apps/web/src/components/workflow/hooks/use-edge-status-updater.ts

import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'
import { useRunStore } from '../store/run-store'
import { useSingleNodeRunStore } from '../store/single-node-run-store'

/**
 * Maps workflow execution status to NodeRunningStatus enum
 * Note: This is only needed for workflow executions which use uppercase status strings
 * Single node results now use NodeRunningStatus directly
 */
function mapWorkflowStatusToNodeRunningStatus(
  status: string | null
): NodeRunningStatus | undefined {
  switch (status) {
    case 'RUNNING':
      return NodeRunningStatus.Running
    case 'SUCCEEDED':
      return NodeRunningStatus.Succeeded
    case 'FAILED':
      return NodeRunningStatus.Failed
    default:
      return undefined
  }
}

/**
 * Hook that updates edge statuses based on connected node statuses
 * Monitors both workflow runs and single node runs
 */
export function useEdgeStatusUpdater() {
  const { getEdges, setEdges } = useReactFlow()
  const prevStatusesRef = useRef<
    Map<string, { source?: NodeRunningStatus; target?: NodeRunningStatus }>
  >(new Map())

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateEdgeStatuses uses getEdges/setEdges internally; getEdges and setEdges are stable ReactFlow refs
  useEffect(() => {
    // Initial update
    const nodeExecutions = useRunStore.getState().nodeExecutions
    const singleNodeState = {
      results: useSingleNodeRunStore.getState().nodeResults,
      running: useSingleNodeRunStore.getState().runningNodes,
    }

    // Check workflow executions first
    if (nodeExecutions.size > 0) {
      updateEdgeStatuses(nodeExecutions, 'workflow')
    } else {
      // Fall back to single node runs
      updateEdgeStatuses(singleNodeState, 'single')
    }

    // Subscribe to run store changes
    const unsubscribeRun = useRunStore.subscribe((state) => {
      updateEdgeStatuses(state.nodeExecutions, 'workflow')
      return state.nodeExecutions
    })

    // Subscribe to single node run store changes
    const unsubscribeSingle = useSingleNodeRunStore.subscribe(
      (state) => ({ results: state.nodeResults, running: state.runningNodes }),
      ({ results, running }) => {
        // Only update from single node runs if no workflow is running
        if (useRunStore.getState().nodeExecutions.size === 0) {
          updateEdgeStatuses({ results, running }, 'single')
        }
      }
    )

    return () => {
      unsubscribeRun()
      unsubscribeSingle()
    }
  }, [])

  function updateEdgeStatuses(data: any, source: 'workflow' | 'single') {
    const edges = getEdges()
    const updates: Array<{ id: string; data: any }> = []
    const currentStatuses = new Map<
      string,
      { source?: NodeRunningStatus; target?: NodeRunningStatus }
    >()

    // Process each edge
    edges.forEach((edge) => {
      let sourceStatus: NodeRunningStatus | undefined
      let targetStatus: NodeRunningStatus | undefined

      if (source === 'workflow') {
        // Get status from workflow executions
        const sourceExecution = data.get(edge.source)
        const targetExecution = data.get(edge.target)

        if (sourceExecution) {
          sourceStatus = mapWorkflowStatusToNodeRunningStatus(sourceExecution.status)
        }

        if (targetExecution) {
          targetStatus = mapWorkflowStatusToNodeRunningStatus(targetExecution.status)
        }
      } else {
        // Get status from single node runs
        const sourceResult = data.results.get(edge.source)
        const targetResult = data.results.get(edge.target)
        const sourceRunning = data.running.has(edge.source)
        const targetRunning = data.running.has(edge.target)

        if (sourceRunning) {
          sourceStatus = NodeRunningStatus.Running
        } else if (sourceResult) {
          // Single node results now use NodeRunningStatus directly
          sourceStatus = sourceResult.status
        }

        if (targetRunning) {
          targetStatus = NodeRunningStatus.Running
        } else if (targetResult) {
          // Single node results now use NodeRunningStatus directly
          targetStatus = targetResult.status
        }
      }

      // Store current statuses
      currentStatuses.set(edge.id, { source: sourceStatus, target: targetStatus })

      // Check if status changed
      const prevStatus = prevStatusesRef.current.get(edge.id) || {}
      const hasChanged = prevStatus.source !== sourceStatus || prevStatus.target !== targetStatus

      if (hasChanged) {
        updates.push({
          id: edge.id,
          data: {
            ...edge.data,
            _sourceRunningStatus: sourceStatus,
            _targetRunningStatus: targetStatus,
          },
        })
      }
    })

    // Apply updates if any
    if (updates.length > 0) {
      // Update edges with new status data
      setEdges((currentEdges) =>
        currentEdges.map((edge) => {
          const update = updates.find((u) => u.id === edge.id)
          if (update) {
            return { ...edge, data: update.data }
          }
          return edge
        })
      )

      // Update previous statuses reference
      prevStatusesRef.current = currentStatuses
    }
  }
}
