// apps/web/src/components/workflow/hooks/run-hooks/use-run-node-completed.ts

import { useCallback } from 'react'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'

export const useRunNodeCompleted = () => {
  const updateNodeExecution = useRunStore((state) => state.updateNodeExecution)

  const handleNodeCompleted = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] NODE_COMPLETED:', event.data.nodeId, event.data)

      const nodeExecution = event.data

      // Update the specific node execution with completed state and full metadata
      updateNodeExecution(nodeExecution.nodeId, {
        status: nodeExecution.status as any,
        outputs: nodeExecution.outputs,
        elapsedTime: nodeExecution.elapsedTime,
        error: nodeExecution.error,
        executionMetadata: nodeExecution.executionMetadata,
        workflowRunId: nodeExecution.workflowRunId,
        nodeType: nodeExecution.nodeType,
        title: nodeExecution.title,
        finishedAt: nodeExecution.finishedAt,
      })
    },
    [updateNodeExecution]
  )

  return { handleNodeCompleted }
}
