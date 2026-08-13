// apps/web/src/components/workflow/hooks/use-edge-status-updater.ts

import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'
import { useRunStore } from '../store/run-store'
import { useSingleNodeRunStore } from '../store/single-node-run-store'

/**
 * Hook that colours edges from the status of the node each one feeds into.
 * Monitors both workflow runs and single node runs.
 *
 * An edge's `_targetRunningStatus` is the single input the custom edge styles
 * from. `undefined` means "no run in view" (normal editor edge); every other
 * value comes straight off the execution — the statuses are already
 * `NodeRunningStatus` on both paths, there is nothing to translate.
 */
export function useEdgeStatusUpdater() {
  const { getEdges, setEdges } = useReactFlow()
  const prevStatusesRef = useRef<Map<string, NodeRunningStatus | undefined>>(new Map())

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
    const unsubscribeRun = useRunStore.subscribe(
      (state) => state.nodeExecutions,
      (nodeExecutions) => updateEdgeStatuses(nodeExecutions, 'workflow')
    )

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
    const updates: Array<{ id: string; status: NodeRunningStatus | undefined }> = []
    const currentStatuses = new Map<string, NodeRunningStatus | undefined>()

    // A run is in view once it has executions. Targets missing from the map are
    // then nodes the run never reached (historical runs only store executed
    // nodes), which is Pending — NOT "no run", which would undim the edge.
    const runInView = source === 'workflow' ? data.size > 0 : data.results.size > 0

    edges.forEach((edge) => {
      let targetStatus: NodeRunningStatus | undefined

      if (source === 'workflow') {
        targetStatus = data.get(edge.target)?.status
      } else if (data.running.has(edge.target)) {
        targetStatus = NodeRunningStatus.Running
      } else {
        targetStatus = data.results.get(edge.target)?.status
      }

      if (!targetStatus && runInView) {
        targetStatus = NodeRunningStatus.Pending
      }

      currentStatuses.set(edge.id, targetStatus)

      if (prevStatusesRef.current.get(edge.id) !== targetStatus) {
        updates.push({ id: edge.id, status: targetStatus })
      }
    })

    // Apply updates if any
    if (updates.length > 0) {
      setEdges((currentEdges) =>
        currentEdges.map((edge) => {
          const update = updates.find((u) => u.id === edge.id)
          if (update) {
            return { ...edge, data: { ...edge.data, _targetRunningStatus: update.status } }
          }
          return edge
        })
      )
    }

    prevStatusesRef.current = currentStatuses
  }
}
