// apps/web/src/components/workflow/canvas/workflow-toolbar.tsx

import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { ClockArrowUp, Play, Plus, Save, Settings, Upload, Variable } from 'lucide-react'
import { useCallback, useState } from 'react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { VariableEditorDialog } from '~/components/workflow/dialogs/variable-editor-dialog'
import { useNonTriggerDefinitions, useReadOnly } from '~/components/workflow/hooks'
import { useChecklist } from '~/components/workflow/hooks/use-checklist'
import { RunHistory } from '~/components/workflow/panels/run/run-history'
import { useCanvasStore } from '~/components/workflow/store/canvas-store'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import { WorkflowChecklist } from '~/components/workflow/ui/workflow-checklist'
import WorkflowVersionsPopover from '~/components/workflow/ui/workflow-versions-popover'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useWorkflowSave } from '../hooks'

interface WorkflowToolbarProps {
  className?: string
}

/**
 * Toolbar for workflow editor
 */
export function WorkflowToolbar({ className }: WorkflowToolbarProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [isShowVersions, setShowVersions] = useState(false)
  // Workflow store - memoized selectors to prevent re-renders
  const workflow = useWorkflowStore((state) => state.workflow)
  const isDirty = useWorkflowStore((state) => state.isDirty)
  const isSaving = useWorkflowStore((state) => state.isSaving)
  // const saveWorkflow = useWorkflowStore((state) => state.saveWorkflow)
  const blockSelectorOpen = useCanvasStore((state) => state.blockSelectorOpen)
  const setBlockSelectorOpen = useCanvasStore((state) => state.setBlockSelectorOpen)
  const { save } = useWorkflowSave()
  // Read-only state for disabling editing actions
  const { isReadOnly } = useReadOnly()

  // Get validation state from checklist hook
  const { errorCount, warningCount } = useChecklist()

  // Get all non-trigger block types for the toolbar
  // Automatically subscribes to registry updates so app blocks appear when they're loaded
  const availableBlocks = useNonTriggerDefinitions().map((node) => node.id)

  // History popover state
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false)

  // Variable editor state
  const [variableEditorOpen, setVariableEditorOpen] = useState(false)

  // Settings panel state
  const settingsPanelOpen = usePanelStore((state) => state.settingsPanelOpen)
  const openSettingsPanel = usePanelStore((state) => state.openSettingsPanel)
  const closeSettingsPanel = usePanelStore((state) => state.closeSettingsPanel)

  // Publish mutation
  const publishMutation = api.workflow.publish.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Workflow published',
        description: 'Your workflow has been published successfully.',
      })
    },
    onError: (error) => {
      toastError({ title: 'Error publishing workflow', description: error.message })
    },
  })

  // Enable keyboard shortcuts
  // Note: Keyboard shortcuts are now handled in WorkflowKeyboardShortcuts component

  const handleSave = async () => {
    await save()
    // await saveWorkflow()
  }
  const handleNodeAdded = useCallback(
    (nodeId: string, nodeType: string) => {
      setBlockSelectorOpen(false)
    },
    [setBlockSelectorOpen]
  )

  const handleTest = () => {
    // Open the run panel with input tab selected
    usePanelStore.getState().openRunPanel()
    usePanelStore.getState().setRunPanelTab('input')
  }

  const handleRunSelect = useCallback((_runId: string) => {
    // Open the run panel with detail tab to show the selected run
    usePanelStore.getState().openRunPanel()
    usePanelStore.getState().setRunPanelTab('detail')
    // Close the history popover
    setHistoryPopoverOpen(false)
  }, [])

  const handlePublish = async () => {
    if (!workflow?.id) {
      toastError({
        title: 'No workflow to publish',
        description: 'Please save the workflow first before publishing.',
      })
      return
    }

    if (!isDirty && workflow.version === 1) {
      toastError({
        title: 'No changes to publish',
        description: 'Make some changes to the workflow before publishing a new version.',
      })
      return
    }

    // Check for validation errors - block publishing if errors exist
    if (errorCount > 0) {
      toastError({
        title: 'Cannot publish workflow',
        description: `Fix ${errorCount} error${errorCount > 1 ? 's' : ''} before publishing. Check the workflow checklist for details.`,
      })
      return
    }

    // Show warning for warnings but allow publishing with confirmation
    if (warningCount > 0) {
      const warningConfirmed = await confirm({
        title: 'Publish with warnings?',
        description: `This workflow has ${warningCount} warning${warningCount > 1 ? 's' : ''}. Do you want to continue publishing?`,
        confirmText: 'Publish Anyway',
        cancelText: 'Cancel',
      })

      if (!warningConfirmed) return
    }

    // Final confirmation dialog
    const confirmed = await confirm({
      title: 'Publish Workflow?',
      description:
        'Are you sure you want to publish the current workflow? This will create a new published version.',
      confirmText: 'Publish',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      publishMutation.mutate({ workflowId: workflow.id })
    }
  }

  return (
    <>
      <div
        className={cn(
          'workflow-toolbar flex items-center justify-between gap-1 bg-primary-150 border-b border-primary-300 rounded-t-lg',
          className
        )}>
        <div className='flex items-center p-1 gap-1 overflow-x-auto overflow-y-visible no-scrollbar shrink-0 flex-1'>
          {/* File operations */}
          <Tooltip content={isReadOnly ? 'Save disabled in read-only mode' : 'Save (Cmd/Ctrl + S)'}>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={handleSave}
              disabled={!isDirty || isReadOnly}
              loading={isSaving}
              loadingText='Saving...'>
              <Save />
            </Button>
          </Tooltip>

          <Separator orientation='vertical' className='h-6' />

          {/* View options */}
          {!isReadOnly && (
            <AddNodeTrigger
              position='standalone'
              onNodeAdded={handleNodeAdded}
              allowedNodeTypes={availableBlocks}
              open={blockSelectorOpen}
              onOpenChange={setBlockSelectorOpen}>
              <div className='shrink-0'>
                <Tooltip content='Add Block' shortcut='N'>
                  <Button variant='ghost' size='icon-sm' className=' '>
                    <Plus />
                  </Button>
                </Tooltip>
              </div>
            </AddNodeTrigger>
          )}
          {isReadOnly && (
            <Tooltip content='Add Block disabled in read-only mode'>
              <Button variant='ghost' size='icon-sm' disabled>
                <Plus />
              </Button>
            </Tooltip>
          )}
          <Tooltip
            content={isReadOnly ? 'Variables disabled in read-only mode' : 'Environment Variables'}>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setVariableEditorOpen(true)}
              disabled={isReadOnly}
              className='text-comparison-500 border border-transparent hover:bg-comparison-50 hover:border-comparison-200 hover:text-comparison-600'>
              <Variable />
              ENV
            </Button>
          </Tooltip>

          {/* <div className="flex-1" /> */}
          <Separator orientation='vertical' className='h-6' />

          {/* Actions */}
          <WorkflowChecklist />
          <Tooltip content={isReadOnly ? 'Test disabled in read-only mode' : 'Test this workflow'}>
            <Button size='sm' variant='ghost' onClick={handleTest} disabled={isReadOnly}>
              <Play />
              Test
            </Button>
          </Tooltip>
          <Popover open={historyPopoverOpen} onOpenChange={setHistoryPopoverOpen}>
            <PopoverTrigger asChild>
              <div className='shrink-0'>
                <Tooltip content='View your run history'>
                  <Button size='sm' variant='ghost' className='shrink-0'>
                    <ClockArrowUp />
                    History
                  </Button>
                </Tooltip>
              </div>
            </PopoverTrigger>
            <RunHistory onRunSelect={handleRunSelect} />
          </Popover>
          <Tooltip content='Workflow settings'>
            <Button
              size='sm'
              variant={settingsPanelOpen ? 'secondary' : 'ghost'}
              onClick={() => (settingsPanelOpen ? closeSettingsPanel() : openSettingsPanel())}>
              <Settings />
              Settings
            </Button>
          </Tooltip>
          <Separator orientation='vertical' className='h-6' />

          <Tooltip
            variant='destructive'
            content={
              errorCount > 0
                ? `Cannot publish: ${errorCount} error${errorCount > 1 ? 's' : ''} must be fixed`
                : isReadOnly
                  ? 'Publish disabled in read-only mode'
                  : warningCount > 0
                    ? `Publish Current Version (${warningCount} warning${warningCount > 1 ? 's' : ''})`
                    : 'Publish Current Version'
            }>
            <Button
              variant='ghost'
              size='sm'
              onClick={handlePublish}
              disabled={publishMutation.isPending || isReadOnly}
              loading={publishMutation.isPending}
              loadingText='Publishing...'>
              <Upload />
              Publish
            </Button>
          </Tooltip>
          <WorkflowVersionsPopover
            open={isShowVersions}
            onOpenChange={setShowVersions}
            workflowId={workflow?.id || ''}
          />
        </div>
        {/* Dock toggle */}
        <div className='shrink-0'>
          <DockToggleButton />
        </div>
      </div>

      {/* Variable Editor Dialog */}
      <VariableEditorDialog open={variableEditorOpen} onOpenChange={setVariableEditorOpen} />

      {/* Confirm Dialog */}
      <ConfirmDialog />
    </>
  )
}
