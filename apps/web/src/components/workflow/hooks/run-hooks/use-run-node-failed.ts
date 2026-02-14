// apps/web/src/components/workflow/hooks/run-hooks/use-run-node-failed.ts

import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import type { ExecutionEvent } from '../../store/run-store'
import { useRunStore } from '../../store/run-store'
import { useNodesInteractions } from '../use-node-interactions'

/**
 * Hook to handle NODE_FAILED events from the workflow execution
 * Provides detailed error handling with node context and error source tracking
 */
export const useRunNodeFailed = () => {
  const updateNodeExecution = useRunStore((state) => state.updateNodeExecution)
  const { handleNodeSelect } = useNodesInteractions()

  const handleNodeFailed = useCallback(
    (event: ExecutionEvent) => {
      console.log('[Run Event] NODE_FAILED:', event.data.nodeId, event.data)

      const nodeExecution = event.data

      // Update the specific node execution with failed state and full metadata
      updateNodeExecution(nodeExecution.nodeId, {
        status: nodeExecution.status as any,
        error: nodeExecution.error,
        errorSource: nodeExecution.errorSource,
        errorMetadata: nodeExecution.errorMetadata,
        elapsedTime: nodeExecution.elapsedTime,
        hasError: true,
        errorHighlight: true,
        executionMetadata: nodeExecution.executionMetadata,
        workflowRunId: nodeExecution.workflowRunId,
        nodeType: nodeExecution.nodeType,
        title: nodeExecution.title,
        finishedAt: nodeExecution.finishedAt,
      })

      // Select the failed node on the canvas
      handleNodeSelect(nodeExecution.nodeId)

      // Show error toast with node context and error source
      const errorTitle = `Node Failed: ${nodeExecution.title || nodeExecution.nodeId}`
      const errorDescription = nodeExecution.errorSource
        ? `${nodeExecution.errorSource}: ${nodeExecution.error}`
        : nodeExecution.error

      toastError({
        title: errorTitle,
        description: errorDescription,
      })
    },
    [updateNodeExecution, handleNodeSelect]
  )

  return { handleNodeFailed }
}
