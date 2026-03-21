// apps/web/src/components/workflow/panels/settings/workflow-settings-panel.tsx

import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { IconPicker, type IconPickerValue } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Copy, Info, MoreHorizontal, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type React from 'react'
import { memo, useCallback, useEffect, useState } from 'react'
import { useDockPortal } from '~/components/global/dock-portal-provider'
import { Tooltip } from '~/components/global/tooltip'
import { DuplicateWorkflowDialog } from '~/components/workflow/dialogs/duplicate-workflow-dialog'
import { useWorkflowSave } from '~/components/workflow/hooks/use-workflow-save'
import { useWorkflowTrigger } from '~/components/workflow/hooks/use-workflow-trigger'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import CollapseWrap from '~/components/workflow/ui/collapse-wrap'
import { useAnalytics } from '~/hooks/use-analytics'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import Section from '../../ui/section'
import { WorkflowAccessSettings } from './workflow-access-settings'

interface WorkflowSettingsPanelProps {
  className?: string
  workflowId?: string
  workflowAppId?: string
}

/**
 * Panel for workflow settings configuration.
 * Supports both overlay (drawer) and docked modes via portal.
 */
export const WorkflowSettingsPanel = memo(function WorkflowSettingsPanel({
  className,
  workflowId,
  workflowAppId,
}: WorkflowSettingsPanelProps) {
  const router = useRouter()
  const closeSettingsPanel = usePanelStore((state) => state.closeSettingsPanel)
  const panelWidth = usePanelStore((state) => state.getSettingsPanelWidth())
  const setPanelWidth = usePanelStore((state) => state.setPanelWidth)

  // Dock state
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const secondaryWidth = useDockStore((state) => state.secondaryWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const setSecondaryWidth = useDockStore((state) => state.setSecondaryWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Portal target for docked mode
  const { primaryPanelRef, secondaryPanelRef } = useDockPortal()
  const panelStack = usePanelStore((state) => state.panelStack)
  const layoutMode = useDockStore((state) => state.layoutMode)

  // Workflow info
  const workflow = useWorkflowStore((state) => state.workflow)
  const setWorkflow = useWorkflowStore((state) => state.setWorkflow)
  const hasPublishedVersion = useWorkflowStore((state) => state.hasPublishedVersion)

  // Query workflowApp data for icon
  const { data: workflowAppData } = api.workflow.getById.useQuery(
    { id: workflowAppId! },
    { enabled: !!workflowAppId }
  )

  // Local state for title/description/icon editing
  const [localTitle, setLocalTitle] = useState(workflow?.name || '')
  const [localDescription, setLocalDescription] = useState(workflow?.description || '')
  const [localIcon, setLocalIcon] = useState<{ iconId: string; color: string } | null>(null)
  const [titleError, setTitleError] = useState<'empty' | null>(null)
  const [isDescriptionCollapsed, setIsDescriptionCollapsed] = useState(true)

  // Dialog state
  const [confirm, ConfirmDialog] = useConfirm()
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const posthog = useAnalytics()

  // Unified save hook for metadata, icon, and share settings
  const { saveMetadata, saveIcon } = useWorkflowSave()

  // Check if workflow has a manual trigger (required for sharing)
  const { triggerType } = useWorkflowTrigger()
  const isManualTrigger = triggerType === WorkflowTriggerType.MANUAL

  // Mutations - for enable/disable toggle (with toast)
  const toggleWorkflow = api.workflow.update.useMutation({
    onSuccess: () => {
      toastSuccess({ description: workflow?.enabled ? 'Workflow disabled' : 'Workflow enabled' })
      if (workflow) {
        setWorkflow({ ...workflow, enabled: !workflow.enabled })
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to update workflow', description: error.message })
    },
  })

  const deleteWorkflow = api.workflow.delete.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Workflow deleted' })
      closeSettingsPanel()
      router.push('/app/workflows')
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete workflow', description: error.message })
    },
  })

  // Determine if using secondary slot (side-by-side mode with run panel open)
  const useSecondarySlot = panelStack.includes('run') && layoutMode !== 'tabbed'

  // Use secondary slot if run panel is open and in side-by-side mode
  const portalRef = useSecondarySlot ? secondaryPanelRef : primaryPanelRef

  // Use appropriate width based on slot
  const currentDockedWidth = useSecondarySlot ? secondaryWidth : dockedWidth
  const setCurrentDockedWidth = useSecondarySlot ? setSecondaryWidth : setDockedWidth

  /** Handle width changes - update appropriate store based on dock state */
  const handleWidthChange = useCallback(
    (width: number) => {
      if (isDocked) {
        setCurrentDockedWidth(width)
      } else {
        setPanelWidth(width)
      }
    },
    [isDocked, setCurrentDockedWidth, setPanelWidth]
  )

  /** Toggle workflow enabled state */
  const handleToggleEnabled = async () => {
    if (!workflowAppId) return
    await toggleWorkflow.mutateAsync({
      id: workflowAppId,
      enabled: !workflow?.enabled,
    })
    posthog?.capture('workflow_toggled', {
      workflow_id: workflowAppId,
      enabled: !workflow?.enabled,
    })
  }

  /** Delete workflow with confirmation */
  const handleDelete = async () => {
    if (!workflowAppId) return

    const confirmed = await confirm({
      title: 'Delete workflow?',
      description: 'This will permanently delete this workflow and all its execution history.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      posthog?.capture('workflow_deleted', { workflow_id: workflowAppId })
      await deleteWorkflow.mutateAsync({ id: workflowAppId })
    }
  }

  /** Sync local state when workflow changes */
  useEffect(() => {
    setLocalTitle(workflow?.name || '')
    setLocalDescription(workflow?.description || '')
  }, [workflow?.name, workflow?.description])

  /** Sync icon from workflowApp data */
  useEffect(() => {
    if (workflowAppData?.icon) {
      setLocalIcon(workflowAppData.icon)
    }
  }, [workflowAppData?.icon])

  /** Validate title */
  const validateTitle = useCallback((title: string): boolean => {
    if (!title.trim()) {
      setTitleError('empty')
      return false
    }
    setTitleError(null)
    return true
  }, [])

  /** Handle title change - only update local state and queue save */
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value
      setLocalTitle(newTitle)

      if (validateTitle(newTitle)) {
        saveMetadata({ name: newTitle })
      }
    },
    [validateTitle, saveMetadata]
  )

  /** Handle title blur - revert if invalid */
  const handleTitleBlur = useCallback(() => {
    if (titleError || !localTitle.trim()) {
      const validTitle = workflow?.name || ''
      setLocalTitle(validTitle)
      setTitleError(null)
    }
  }, [titleError, localTitle, workflow?.name])

  /** Handle title keyboard events */
  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        const validTitle = workflow?.name || ''
        setLocalTitle(validTitle)
        setTitleError(null)
        e.currentTarget.blur()
      }
    },
    [workflow?.name]
  )

  /** Handle description change - only update local state and queue save */
  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newDesc = e.target.value
      setLocalDescription(newDesc)
      saveMetadata({ description: newDesc })
    },
    [saveMetadata]
  )

  /** Handle description keyboard events */
  const handleDescriptionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        const originalDesc = workflow?.description || ''
        setLocalDescription(originalDesc)
        e.currentTarget.blur()
      }
    },
    [workflow?.description]
  )

  /** Handle icon change from picker */
  const handleIconChange = useCallback(
    (value: IconPickerValue) => {
      const iconData = { iconId: value.icon, color: value.color }
      setLocalIcon(iconData)
      // Persist via unified save hook (debounced)
      saveIcon(iconData)
    },
    [saveIcon]
  )

  // Safety check - don't render if not in panel stack
  if (panelWidth === 0) return null

  return (
    <>
      <ConfirmDialog />
      <DuplicateWorkflowDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        workflowId={workflowAppId || ''}
        workflowName={workflow?.name || 'Workflow'}
      />
      <DockableDrawer
        open={true}
        onOpenChange={(open) => !open && closeSettingsPanel()}
        isDocked={isDocked}
        width={isDocked ? currentDockedWidth : panelWidth}
        onWidthChange={handleWidthChange}
        minWidth={minWidth}
        maxWidth={maxWidth}
        title='Workflow Settings'
        portalTarget={portalRef}
        panelType='settings'>
        {/* Header */}
        <DrawerHeader
          icon={<EntityIcon iconId='settings' color='gray' className='size-6' />}
          title='Workflow Settings'
          onClose={closeSettingsPanel}
          actions={
            <>
              {/* Enable/Disable Toggle */}
              <Tooltip content={workflow?.enabled ? 'Disable workflow' : 'Enable workflow'}>
                <Button
                  variant='ghost'
                  size='sm'
                  className='rounded-full gap-1.5 text-xs'
                  onClick={handleToggleEnabled}
                  disabled={toggleWorkflow.isPending}
                  tabIndex={-1}>
                  <div
                    className={`size-2 rounded-full ${workflow?.enabled ? 'bg-good-500' : 'bg-bad-500'}`}
                  />
                  {workflow?.enabled ? 'Enabled' : 'Disabled'}
                </Button>
              </Tooltip>

              {/* More Actions Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant='ghost' size='icon-sm' className='rounded-full' tabIndex={-1}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={() => setDuplicateDialogOpen(true)}>
                    <Copy />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleDelete} variant='destructive'>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
        {/* Content */}
        <div className='flex-1 flex-col flex overflow-y-auto'>
          <CollapseWrap
            minHeight={60}
            isCollapsed={isDescriptionCollapsed}
            onCollapsedChange={setIsDescriptionCollapsed}
            className='sticky top-0 z-12 border-b bg-primary-50/90 backdrop-blur-sm'>
            <div className='relative flex flex-row gap-1 px-2 py-1.5'>
              <IconPicker
                value={
                  localIcon
                    ? { icon: localIcon.iconId, color: localIcon.color }
                    : { icon: 'text', color: 'blue' }
                }
                onChange={handleIconChange}>
                <button
                  type='button'
                  className='rounded-md p-0.5 hover:bg-primary-100 transition-colors'>
                  <EntityIcon
                    iconId={localIcon?.iconId ?? 'text'}
                    color={localIcon?.color ?? 'blue'}
                    className='size-6'
                  />
                </button>
              </IconPicker>
              <Input
                id='title'
                variant='transparent'
                value={localTitle}
                onChange={handleTitleChange}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                placeholder='Enter workflow title'
                tabIndex={-1}
                className={cn(
                  'h-7 min-w-0 w-full appearance-none rounded-md border px-1 outline-none focus-visible:ring-1 focus-visible:ring-blue-500',
                  titleError ? 'border-red-500 ring-1 ring-red-500' : 'border-transparent',
                  'focus:shadow-xs'
                )}
              />
              {titleError && (
                <div className='absolute left-9 top-full z-20 mt-0.5 text-xs text-red-500'>
                  Title cannot be empty
                </div>
              )}
            </div>
            <div className='leading-0 group flex rounded-lg px-2 py-[5px]'>
              <AutosizeTextarea
                id='description'
                minHeight={1}
                value={localDescription}
                onChange={handleDescriptionChange}
                onKeyDown={handleDescriptionKeyDown}
                onFocus={() => setIsDescriptionCollapsed(false)}
                onBlur={() => setIsDescriptionCollapsed(true)}
                className='w-full resize-none appearance-none border-none py-1 px-2 bg-transparent text-xs leading-[18px] caret-[#295EFF] outline-none dark:bg-transparent'
                placeholder='Enter workflow description'
              />
            </div>
          </CollapseWrap>
          <div className='flex-1'>
            {workflowAppId && isManualTrigger && (
              <WorkflowAccessSettings
                workflowAppId={workflowAppId}
                shareToken={workflowAppData?.shareToken}
                webEnabled={workflowAppData?.webEnabled}
                apiEnabled={workflowAppData?.apiEnabled}
                accessMode={workflowAppData?.accessMode}
                config={workflowAppData?.config}
                rateLimit={workflowAppData?.rateLimit}
                hasPublishedVersion={hasPublishedVersion}
                workflowEnabled={workflow?.enabled}
              />
            )}
            {workflowAppId && !isManualTrigger && (
              <Section title='Sharing' collapsible={false}>
                <div className='flex items-start gap-3 p-3 bg-muted/50 rounded-lg'>
                  <Info className='size-5 text-muted-foreground shrink-0 mt-0.5' />
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>Sharing not available</p>
                    <p className='text-xs text-muted-foreground'>
                      Only workflows with a Manual trigger can be shared publicly. Change the
                      trigger type to Manual to enable sharing.
                    </p>
                  </div>
                </div>
              </Section>
            )}
          </div>
        </div>
      </DockableDrawer>
    </>
  )
})
