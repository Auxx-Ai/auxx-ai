// apps/web/src/components/workflow/hooks/run-hooks/use-run-workflow-started.ts

import { useStoreApi } from '@xyflow/react'
import { produce } from 'immer'
import { useCallback } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'
import type { ExecutionEvent, NodeExecutionState } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'
import type { FlowEdge, FlowNode } from '../../types'

export const useRunWorkflowStarted = () => {
  const reactFlowStore = useStoreApi<FlowNode, FlowEdge>()
  const setNodeExecutions = useRunStore((state) => state.setNodeExecutions)
  const setIsRunning = useRunStore((state) => state.setIsRunning)
  const handleWorkflowStarted = useCallback(
    (event: ExecutionEvent) => {
      // Get current workflow nodes from ReactFlow store
      const { nodes, edges, setEdges } = reactFlowStore.getState()
      // Initialize nodeExecutions for all nodes in the workflow
      // Optimistic placeholders: the backend has not written any row yet, so the
      // ownership columns are blank — the same convention `treeToExecutions`
      // uses for its synthetic pending rows. They are replaced by the real rows
      // as NODE_STARTED / NODE_FINISHED events arrive.
      const nodeExecutions = new Map<string, NodeExecutionState>()
      nodes.forEach((node, order) => {
        const nodeExecution: NodeExecutionState = {
          id: `${event.workflowRunId}_${node.id}`,
          workflowRunId: event.workflowRunId,
          nodeId: node.id,
          nodeType: node.data?.type || node.type || 'unknown',
          title: node.data?.title || node.data?.name || `${node.type || 'Unknown'} Node`,
          status: NodeRunningStatus.Pending,
          organizationId: '',
          workflowAppId: '',
          workflowId: '',
          triggeredFrom: 'WORKFLOW_RUN',
          index: order,
          inputs: null,
          processData: null,
          outputs: null,
          error: null,
          elapsedTime: null,
          executionMetadata: null,
          predecessorNodeId: null,
          createdById: null,
          createdAt: new Date(),
          finishedAt: null,
        }
        nodeExecutions.set(node.id, nodeExecution)
      })
      // Update run store state using helper methods
      setNodeExecutions(nodeExecutions)
      setIsRunning(true)
      // The run flags live on `edge.data` — that is where the custom edge reads
      // them. Setting them on the edge itself left every edge un-styled for the
      // whole run.
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          edge.data = {
            ...edge.data,
            _waitingRun: true,
            _sourceRunningStatus: undefined,
            _targetRunningStatus: undefined,
          }
        })
      })
      setEdges(newEdges)
      console.log(`[Run Event] Initialized ${nodeExecutions.size} node executions`)
    },
    [reactFlowStore, setNodeExecutions, setIsRunning]
  )
  return { handleWorkflowStarted }
}
