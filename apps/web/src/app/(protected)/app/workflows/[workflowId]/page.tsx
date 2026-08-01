// apps/web/src/app/(protected)/app/workflows/[workflowId]/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs } from '@auxx/ui/components/main-page-tabs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { ChartColumn, History, MousePointerClick, Settings, Workflow } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { use, useState } from 'react'
import { DockedPanelTarget, DockPortalProvider } from '~/components/global/dock-portal-provider'
import { DockedPanelsContainer } from '~/components/global/docked-panels-container'
import { Tooltip } from '~/components/global/tooltip'
import { WorkflowEditor } from '~/components/workflow'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { useWorkflowAccess } from '~/components/workflow/hooks/use-workflow-access'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { WorkflowBreadcrumbSwitcher } from '~/components/workflow/ui/workflow-breadcrumb-switcher'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { WorkflowAnalytics } from '../_components/analytics/workflow-analytics'
import { WorkflowExecutions } from '../_components/executions/workflow-executions'

interface EditWorkflowPageProps {
  params: Promise<{ workflowId: string }>
}

/** Tabs backed by the `?t=` query param. */
const MODES = ['editor', 'analytics', 'executions'] as const

export default function EditWorkflowPage({ params }: EditWorkflowPageProps) {
  const { workflowId } = use(params)

  const [mode, setMode] = useQueryState('t', parseAsStringLiteral(MODES).withDefault('editor'))

  const [editDialogOpen, setEditDialogOpen] = useState(false)

  // Dock state for the property panel
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const secondaryWidth = useDockStore((state) => state.secondaryWidth)
  const setSecondaryWidth = useDockStore((state) => state.setSecondaryWidth)
  const layoutMode = useDockStore((state) => state.layoutMode)
  const autoBreakpoint = useDockStore((state) => state.autoBreakpoint)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)
  const panelStack = usePanelStore((state) => state.panelStack)

  // Check if wide screen for auto layout mode
  const isWideScreen = useMedia(`(min-width: ${autoBreakpoint}px)`)

  const { data: workflow, isLoading } = api.workflow.getById.useQuery(
    { id: workflowId },
    { enabled: !!workflowId }
  )

  // Renaming the workflow (the header's Settings button opens the name/
  // description form) is the `admin` rung of per-workflow access (plan 30 §4).
  const { canAdmin } = useWorkflowAccess(workflowId)

  // Show docked panel in editor mode, or executions mode when docked
  const showDockedPanel = isDocked && (mode === 'editor' || mode === 'executions')

  // Check panel presence
  const hasPropertyPanel = panelStack.includes('property')
  const hasRunPanel = panelStack.includes('run')
  const panelCount = panelStack.length

  // Determine effective layout mode
  const effectiveLayout = (() => {
    if (panelCount <= 1) return 'single'
    if (layoutMode === 'tabbed') return 'tabbed'
    if (layoutMode === 'side-by-side') return 'side-by-side'
    // Auto mode: use side-by-side on wide screens
    return 'side-by-side'
    //return isWideScreen ? 'side-by-side' : 'tabbed'
  })()

  // Fallback shown when no panels are open
  const panelFallback = (
    <div className='flex-1 flex flex-col items-center justify-center text-muted-foreground'>
      <MousePointerClick className='size-6 mb-2 opacity-50' />
      <p className='text-sm'>Select a node</p>
    </div>
  )

  // Build the docked panels config
  const dockedPanels: DockedPanelConfig[] | undefined = (() => {
    if (!showDockedPanel) return undefined

    // Executions mode: single panel with portal target for execution detail drawer
    if (mode === 'executions') {
      return [
        {
          key: 'executions',
          content: <DockedPanelTarget slot='primary' />,
          width: dockedWidth,
          onWidthChange: setDockedWidth,
          minWidth,
          maxWidth,
        },
      ]
    }

    // Editor mode - Side-by-side: return array of separate panel configs
    if (effectiveLayout === 'side-by-side' && panelCount > 1) {
      const panels: DockedPanelConfig[] = []
      if (hasPropertyPanel) {
        panels.push({
          key: 'property',
          content: <DockedPanelTarget slot='primary' panelFilter='property' />,
          width: dockedWidth,
          onWidthChange: setDockedWidth,
          minWidth,
          maxWidth,
        })
      }
      if (hasRunPanel) {
        panels.push({
          key: 'run',
          content: <DockedPanelTarget slot='secondary' panelFilter='run' />,
          width: secondaryWidth,
          onWidthChange: setSecondaryWidth,
          minWidth,
          maxWidth,
        })
      }
      return panels
    }

    // Editor mode - Single or tabbed: single panel with DockedPanelsContainer
    return [
      {
        key: 'main',
        content: <DockedPanelsContainer fallback={panelFallback} />,
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth,
        maxWidth,
      },
    ]
  })()

  return (
    <DockPortalProvider>
      <MainPage>
        <MainPageHeader
          className='justify-start'
          action={
            <div className='flex items-center gap-2 shrink-0'>
              <MainPageTabs
                items={[
                  { value: 'editor', label: 'Editor', icon: <Workflow /> },
                  { value: 'analytics', label: 'Analytics', icon: <ChartColumn /> },
                  { value: 'executions', label: 'Executions', icon: <History /> },
                ]}
                value={mode}
                onValueChange={(v) => {
                  const next = MODES.find((m) => m === v)
                  if (next) setMode(next)
                }}
                className='flex-1 shrink-0'
              />
              {canAdmin && (
                <Tooltip content='Edit Workflow Details'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() => setEditDialogOpen(true)}
                    disabled={isLoading}>
                    <Settings />
                  </Button>
                </Tooltip>
              )}
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Workflows' href='/app/workflows' />
            <WorkflowBreadcrumbSwitcher
              activeWorkflowId={workflowId}
              activeLabel={isLoading ? <Skeleton className='h-4 w-32' /> : (workflow?.name ?? '')}
            />
          </MainPageBreadcrumb>
        </MainPageHeader>

        <MainPageContent
          className={cn(mode !== 'executions' && 'overflow-visible')}
          dockedPanels={dockedPanels}>
          {mode === 'editor' && (
            <WorkflowEditor workflowId={workflowId} className='h-full' readOnly={false} />
          )}
          {mode === 'analytics' && <WorkflowAnalytics workflowId={workflowId} />}

          {mode === 'executions' && <WorkflowExecutions workflowId={workflowId} />}
        </MainPageContent>
      </MainPage>

      {workflow && (
        <WorkflowFormDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          mode='edit'
          workflow={{
            id: workflowId,
            name: workflow.name,
            description: workflow.description,
          }}
        />
      )}
    </DockPortalProvider>
  )
}
