// apps/web/src/components/workflow/canvas/workflow-operators.tsx

import React, { useEffect, useMemo, useState, memo, useCallback } from 'react'
import { Button } from '@auxx/ui/components/button'
import {
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Maximize,
  MousePointer2,
  Hand,
  Shuffle,
  Play,
  Loader2,
} from 'lucide-react'
import { useCanvasStore } from '~/components/workflow/store/canvas-store'
import { useHistoryManager } from '~/components/workflow/store/workflow-store-provider'
import { useInteractionStore } from '~/components/workflow/store/interaction-store'
import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'
import { useWorkflowOrganize } from '~/components/workflow/hooks'
import { storeEventBus } from '~/components/workflow/store/event-bus'
import { useReadOnly } from '~/components/workflow/hooks'
import { HistoryCommandPopover } from '~/components/workflow/ui/history-command-popover'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { useWorkflowRun } from '~/hooks/use-workflow-run'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { debounce } from 'lodash'

interface WorkflowOperatorsProps {
  className?: string
}

/**
 * Workflow operators panel with interaction and navigation controls
 */
export const WorkflowOperators = memo(function WorkflowOperators({
  className,
}: WorkflowOperatorsProps) {
  const historyManager = useHistoryManager()

  // Canvas store - memoized selectors to prevent re-renders
  const zoomIn = useCanvasStore((state) => state.zoomIn)
  const zoomOut = useCanvasStore((state) => state.zoomOut)
  const fitView = useCanvasStore((state) => state.fitView)

  // Read-only state for disabling editing actions
  const { isReadOnly } = useReadOnly()

  // Interaction store - memoized selectors to prevent re-renders
  const interactionMode = useInteractionStore((state) => state.mode)
  const setInteractionMode = useInteractionStore((state) => state.setMode)

  // History state
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false)

  // Workflow organization - memoized to prevent re-renders
  const { handleLayout, canOrganize } = useWorkflowOrganize()

  // Workflow and run state
  const workflowAppId = useWorkflowStore((state) => state.workflow?.id)

  // Run state
  const isRunning = useRunStore((state) => state.isRunning)
  const activeRun = useRunStore((state) => state.activeRun)
  const getExecutionProgress = useRunStore((state) => state.getExecutionProgress)
  const nodeExecutions = useRunStore((state) => state.nodeExecutions)

  // Workflow run hook for SSE and lifecycle management
  const { startRun, stopWorkflow } = useWorkflowRun()

  // Calculate progress
  const progress = useMemo(() => {
    if (!isRunning || !activeRun) return 0
    return getExecutionProgress()
  }, [isRunning, activeRun, getExecutionProgress])

  // Check if we can run the workflow
  const canRunWorkflow = false

  // Debounced handlers to prevent duplicate requests
  const handleRunWorkflow = useCallback(
    debounce(() => {
      if (!workflowAppId) return

      try {
        // Run with default test inputs
        startRun({
          workflowId: workflowAppId,
          inputs: {
            message: {
              subject: 'Test Message',
              textPlain: 'This is a test message for workflow execution.',
              from: { identifier: 'test@example.com', name: 'Test User' },
              isInbound: true,
            },
          },
          mode: 'test',
        })

        toastSuccess({ title: 'Workflow started', description: 'Running workflow in test mode' })
      } catch (error) {
        console.error('[Workflow Operators] Failed to start workflow:', error)
        toastError({
          title: 'Failed to start workflow',
          description:
            error instanceof Error
              ? error.message
              : 'An error occurred while starting the workflow',
        })
      }
    }, 300),
    [workflowAppId, startRun]
  )

  // Subscribe to history changes via event bus
  useEffect(() => {
    // Set initial state
    setCanUndo(historyManager.canUndo())
    setCanRedo(historyManager.canRedo())

    // Subscribe to history change events
    const unsubscribe = storeEventBus.on('history:changed', (data) => {
      setCanUndo(data.canUndo)
      setCanRedo(data.canRedo)
    })

    return unsubscribe
  }, [historyManager])

  const handleUndo = () => {
    historyManager.undo()
  }

  const handleRedo = () => {
    historyManager.redo()
  }

  return (
    <div className={cn('workflow-operators flex flex-row gap-2', className)}>
      {/* Run controls */}
      <div className="flex items-center gap-0.5 p-0.5 bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-lg ring-black/5 ring-1">
        <Button
          variant={isRunning ? 'secondary' : 'ghost'}
          size="icon-sm"
          className="hover:dark:bg-white/15"
          onClick={handleRunWorkflow}
          disabled={!canRunWorkflow || isRunning}>
          {isRunning ? <Loader2 className="animate-spin" /> : <Play />}
        </Button>

        {/* Progress indicator */}
        {isRunning && activeRun && (
          <div className="px-2 flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{progress}%</span>
            {activeRun.totalSteps > 0 && (
              <span className="text-xs text-muted-foreground">
                ({nodeExecutions.size}/{activeRun.totalSteps})
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5 p-0.5 bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-lg ring-black/5 ring-1">
        {/* Interaction modes */}
        <Tooltip content="Pointer Mode" shortcut="V">
          <Button
            variant={interactionMode === 'pointer' ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="hover:dark:bg-white/15"
            onClick={() => setInteractionMode('pointer')}>
            <MousePointer2 />
          </Button>
        </Tooltip>
        <Tooltip content="Pan Mode" shortcut={['H', '␣']}>
          <Button
            variant={interactionMode === 'pan' ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="hover:dark:bg-white/15"
            onClick={() => setInteractionMode('pan')}>
            <Hand />
          </Button>
        </Tooltip>
      </div>
      <div className="flex items-center gap-0.5 p-0.5 bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-lg ring-black/5 ring-1">
        {/* History */}
        <Tooltip
          content={isReadOnly ? 'Undo disabled in read-only mode' : 'Undo'}
          shortcut={['⌃Z', '⌘Z']}>
          <Button
            variant="ghost"
            className="hover:dark:bg-white/15"
            size="icon-sm"
            onClick={handleUndo}
            disabled={!canUndo || isReadOnly}>
            <Undo />
          </Button>
        </Tooltip>
        <Tooltip
          content={isReadOnly ? 'Redo disabled in read-only mode' : 'Redo'}
          shortcut={['⌃⇧Z', '⌘⇧Z']}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:dark:bg-white/15"
            onClick={handleRedo}
            disabled={!canRedo || isReadOnly}>
            <Redo />
          </Button>
        </Tooltip>
        <HistoryCommandPopover open={historyPopoverOpen} onOpenChange={setHistoryPopoverOpen} />
      </div>

      <div className="flex items-center gap-0.5 p-0.5 bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-lg ring-black/5 ring-1">
        <Tooltip content="Zoom In" shortcut={['⌘=', '⌃=']}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={zoomIn}
            className="hover:dark:bg-white/15">
            <ZoomIn />
          </Button>
        </Tooltip>
        <Tooltip content="Zoom Out" shortcut={['⌘-', '⌃-']}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={zoomOut}
            className="hover:dark:bg-white/15">
            <ZoomOut />
          </Button>
        </Tooltip>
        <Tooltip content="Fit View" shortcut={['F', '⌘0', '⌃0']}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={fitView}
            className="hover:dark:bg-white/15">
            <Maximize />
          </Button>
        </Tooltip>
        <Tooltip
          content={isReadOnly ? 'Layout disabled in read-only mode' : 'Organize Layout'}
          shortcut={'⇧A'}>
          <Button
            variant="ghost"
            className="hover:dark:bg-white/15"
            size="icon-sm"
            onClick={handleLayout}
            disabled={isReadOnly}>
            <Shuffle />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
})
