// apps/web/src/components/workflow/hooks/run-hooks/use-run-events.ts

import { WorkflowEventType } from '@auxx/lib/workflow-engine/types'
import { useMemo } from 'react'
import { useRunCreated } from './use-run-created'
import { useRunLoopCompleted } from './use-run-loop-completed'
import { useRunLoopNext } from './use-run-loop-next'
import { useRunLoopStarted } from './use-run-loop-started'
import { useRunNodeCompleted } from './use-run-node-completed'
import { useRunNodeFailed } from './use-run-node-failed'
import { useRunNodeStarted } from './use-run-node-started'
import { useRunWorkflowCancelled } from './use-run-workflow-cancelled'
import { useRunWorkflowFailed } from './use-run-workflow-failed'
import { useRunWorkflowFinished } from './use-run-workflow-finished'
import { useRunWorkflowPaused } from './use-run-workflow-paused'
import { useRunWorkflowStarted } from './use-run-workflow-started'

export const useRunEvents = () => {
  // Get handlers from individual hooks
  const { handleRunCreated } = useRunCreated()
  const { handleWorkflowStarted } = useRunWorkflowStarted()
  const { handleWorkflowFinished } = useRunWorkflowFinished()
  const { handleWorkflowFailed } = useRunWorkflowFailed()
  const { handleWorkflowCancelled } = useRunWorkflowCancelled()
  const { handleWorkflowPaused } = useRunWorkflowPaused()
  const { handleNodeStarted } = useRunNodeStarted()
  const { handleNodeCompleted } = useRunNodeCompleted()
  const { handleNodeFailed } = useRunNodeFailed()
  const { handleLoopStarted } = useRunLoopStarted()
  const { handleLoopNext } = useRunLoopNext()
  const { handleLoopCompleted } = useRunLoopCompleted()

  // Create event handler mapping
  const eventHandlers = useMemo(
    () => ({
      [WorkflowEventType.RUN_CREATED]: handleRunCreated,
      [WorkflowEventType.WORKFLOW_STARTED]: handleWorkflowStarted,
      [WorkflowEventType.WORKFLOW_FINISHED]: handleWorkflowFinished,
      [WorkflowEventType.WORKFLOW_FAILED]: handleWorkflowFailed,
      [WorkflowEventType.WORKFLOW_CANCELLED]: handleWorkflowCancelled,
      [WorkflowEventType.WORKFLOW_PAUSED]: handleWorkflowPaused,
      [WorkflowEventType.NODE_STARTED]: handleNodeStarted,
      [WorkflowEventType.NODE_COMPLETED]: handleNodeCompleted,
      [WorkflowEventType.NODE_FAILED]: handleNodeFailed,
      [WorkflowEventType.LOOP_STARTED]: handleLoopStarted,
      [WorkflowEventType.LOOP_NEXT]: handleLoopNext,
      [WorkflowEventType.LOOP_COMPLETED]: handleLoopCompleted,
    }),
    [
      handleRunCreated,
      handleWorkflowStarted,
      handleWorkflowFinished,
      handleWorkflowFailed,
      handleWorkflowCancelled,
      handleWorkflowPaused,
      handleNodeStarted,
      handleNodeCompleted,
      handleNodeFailed,
      handleLoopStarted,
      handleLoopNext,
      handleLoopCompleted,
    ]
  )

  return { eventHandlers }
}
