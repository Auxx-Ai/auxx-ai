// apps/web/src/components/workflow/hooks/run-hooks/use-run-node-started.ts

import { useCallback } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'

export const useRunNodeStarted = () => {
  const updateNodeExecution = useRunStore((state) => state.updateNodeExecution)

  const handleNodeStarted = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] NODE_STARTED:', event.data.nodeId, event.data)

      const nodeExecution = event.data

      // Update the specific node execution with started state and full metadata
      updateNodeExecution(nodeExecution.nodeId, {
        status: NodeRunningStatus.Running as any,
        inputs: nodeExecution.inputs,
        executionMetadata: nodeExecution.executionMetadata,
        workflowRunId: nodeExecution.workflowRunId,
        nodeType: nodeExecution.nodeType,
        title: nodeExecution.title,
        createdAt: nodeExecution.createdAt,
      })
    },
    [updateNodeExecution]
  )

  return { handleNodeStarted }
}
