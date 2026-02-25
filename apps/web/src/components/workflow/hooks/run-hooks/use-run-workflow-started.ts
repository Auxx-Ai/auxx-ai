// apps/web/src/components/workflow/hooks/run-hooks/use-run-workflow-started.ts

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/types'
import { useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { useCallback } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'

export const useRunWorkflowStarted = () => {
  const reactFlowStore = useStoreApi()
  const setNodeExecutions = useRunStore((state) => state.setNodeExecutions)
  const setIsRunning = useRunStore((state) => state.setIsRunning)
  const handleWorkflowStarted = useCallback(
    (event: ExecutionEvent) => {
      // Get current workflow nodes from ReactFlow store
      const { nodes, edges, setEdges } = reactFlowStore.getState()
      // Initialize nodeExecutions for all nodes in the workflow
      const nodeExecutions = new Map<string, WorkflowNodeExecution>()
      nodes.forEach((node) => {
        const nodeExecution: WorkflowNodeExecution = {
          id: `${event.workflowRunId}_${node.id}`,
          workflowRunId: event.workflowRunId,
          nodeId: node.id,
          nodeType: node.data?.type || node.type || 'unknown',
          title: node.data?.title || node.data?.name || `${node.type || 'Unknown'} Node`,
          status: NodeRunningStatus.Pending as any,
          inputs: null,
          outputs: null,
          error: null,
          elapsedTime: null,
          createdAt: new Date(),
          startedAt: null,
          finishedAt: null,
        }
        nodeExecutions.set(node.id, nodeExecution)
      })
      // Update run store state using helper methods
      setNodeExecutions(nodeExecutions)
      setIsRunning(true)
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          edge._waitingRun = true
          edge._sourceRunningStatus = undefined
          edge._targetRunningStatus = undefined
          // edge.data = {
          //   ...edge.data,
          //   _sourceRunningStatus: undefined,
          //   _targetRunningStatus: undefined,
          //   _waitingRun: true,
          // }
        })
      })
      setEdges(newEdges)
      console.log(newEdges)
      console.log(`[Run Event] Initialized ${nodeExecutions.size} node executions`)
    },
    [reactFlowStore, setNodeExecutions, setIsRunning]
  )
  return { handleWorkflowStarted }
}
