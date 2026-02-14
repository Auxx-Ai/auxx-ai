// apps/web/src/components/workflow/hooks/use-workflow-run-node-sync.ts

import { useReactFlow } from '@xyflow/react'
import { useEffect } from 'react'
import { useRunStore } from '../store/run-store'
import { NodeRunningStatus } from '../types'

/**
 * Hook that syncs node running status with workflow run state
 * Sets all nodes to Pending status when a workflow run starts
 */
export function useWorkflowRunNodeSync() {
  const { getNodes, setNodes } = useReactFlow()
  const activeRun = useRunStore((state) => state.activeRun)
  const isRunning = useRunStore((state) => state.isRunning)

  useEffect(() => {
    // When a workflow run starts (isRunning becomes true and we have an active run)
    if (isRunning && activeRun) {
      console.log('[Node Sync] Workflow run started, setting all nodes to Pending status')

      // Get all current nodes
      const nodes = getNodes()

      // Update all nodes to have Pending status
      const updatedNodes = nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          _runningStatus: NodeRunningStatus.Pending,
        },
      }))

      // Apply the updates
      setNodes(updatedNodes)

      console.log('[Node Sync] Updated', updatedNodes.length, 'nodes to Pending status')
    }

    // When a workflow run completes (isRunning becomes false)
    if (!isRunning && activeRun === null) {
      console.log('[Node Sync] Workflow run ended, clearing node statuses')

      // Get all current nodes
      const nodes = getNodes()

      // Clear running status from all nodes
      const updatedNodes = nodes.map((node) => {
        const { _runningStatus, ...restData } = node.data
        return {
          ...node,
          data: restData,
        }
      })

      // Apply the updates
      setNodes(updatedNodes)
    }
  }, [isRunning, activeRun, getNodes, setNodes])

  // Subscribe to node execution updates to sync individual node statuses
  useEffect(() => {
    const unsubscribe = useRunStore.subscribe(
      (state) => state.nodeExecutions,
      (nodeExecutions) => {
        if (nodeExecutions.size === 0) return

        // Get current nodes
        const nodes = getNodes()
        let hasUpdates = false

        // Update nodes with execution status
        const updatedNodes = nodes.map((node) => {
          const execution = nodeExecutions.get(node.id)

          if (execution) {
            // Map execution status to NodeRunningStatus
            let status: NodeRunningStatus | undefined

            // The execution status should already be a NodeRunningStatus value
            if (execution.status) {
              status = execution.status as NodeRunningStatus
            }

            // Only update if status changed
            if (node.data._runningStatus !== status) {
              hasUpdates = true
              return {
                ...node,
                data: {
                  ...node.data,
                  _runningStatus: status,
                },
              }
            }
          }

          return node
        })

        // Apply updates if any
        if (hasUpdates) {
          setNodes(updatedNodes)
          console.log('[Node Sync] Updated node statuses from execution data')
        }
      }
    )

    return () => {
      unsubscribe()
    }
  }, [getNodes, setNodes])
}
