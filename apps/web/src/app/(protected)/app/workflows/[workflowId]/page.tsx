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
import { KopilotContext } from '~/components/kopilot/context/kopilot-context'
import { WorkflowEditor } from '~/components/workflow'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { useWorkflowAccess } from '~/components/workflow/hooks/use-workflow-access'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
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

/**
 * Slot order for side-by-side docked panels: the first open panel in this order
 * takes `primary`, the second takes `secondary`.
 *
 * This MUST stay in sync with the `useSecondarySlot` derivation each panel does
 * for itself (`workflow-run-panel.tsx`, `workflow-settings-panel.tsx`) — a panel
 * that portals into a slot this page didn't emit renders into a detached node
 * and silently disappears.
 */
const DOCK_PANEL_PRIORITY = ['property', 'run', 'settings'] as const

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

  // Live canvas dirty flag for the Kopilot workflow chip (advisory — the
  // graph-edit tools refuse mutations while the canvas has unsaved changes).
  const isCanvasDirty = useWorkflowStore((state) => state.isDirty)

  // Show docked panel in editor mode, or executions mode when docked
  const showDockedPanel = isDocked && (mode === 'editor' || mode === 'executions')

  // Open panels in slot order — the first takes `primary`, the second `secondary`.
  const orderedPanels = DOCK_PANEL_PRIORITY.filter((panel) => panelStack.includes(panel))
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

    // Editor mode - Side-by-side: one target per open panel, in slot order.
    //
    // Emitting by POSITION rather than by hardcoded panel type is what keeps
    // `settings` working: the previous version handled `property` and `run`
    // only, so opening Test then Settings emitted a single `run`/secondary
    // target — leaving Settings filtered out of it and the Run panel portalling
    // into a now-detached `primary`, i.e. both panels vanished.
    //
    // Only two pairs are reachable ({property, run} and {run, settings}) because
    // `openPanel('properties')` and `openSettingsPanel` close each other, so the
    // first two entries of `orderedPanels` are always the open pair.
    if (effectiveLayout === 'side-by-side' && panelCount > 1) {
      return orderedPanels.slice(0, 2).map((panel, index) => ({
        key: panel,
        content: (
          <DockedPanelTarget slot={index === 0 ? 'primary' : 'secondary'} panelFilter={panel} />
        ),
        width: index === 0 ? dockedWidth : secondaryWidth,
        onWidthChange: index === 0 ? setDockedWidth : setSecondaryWidth,
        minWidth,
        maxWidth,
      }))
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
      {/* Kopilot page + workflow chip. The page key is `WORKFLOW_BUILDER_PAGE`
          from `@auxx/lib/ai/kopilot` — hardcoded like every other builder page
          (KB's 'kb', the agent builder's 'agents.builder'); the stream route
          gates the graph tools on it. */}
      <KopilotContext
        page='workflow.builder'
        activeWorkflowId={workflowId}
        activeWorkflowLabel={workflow?.name ?? undefined}
        activeWorkflowIsDirty={isCanvasDirty}
      />
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
