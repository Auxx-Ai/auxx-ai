// apps/web/src/app/(protected)/app/workflows/[workflowId]/page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { MainPageTabs } from '@auxx/ui/components/main-page-tabs'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { ChartColumn, History, Settings, Workflow } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { use, useState } from 'react'
import { DockedPanelTarget, DockPortalProvider } from '~/components/global/dock-portal-provider'
import { Tooltip } from '~/components/global/tooltip'
import { KopilotContext } from '~/components/kopilot/context/kopilot-context'
import { WorkflowEditor } from '~/components/workflow'
import { WorkflowFormDialog } from '~/components/workflow/dialogs/workflow-form-dialog'
import { useWorkflowAccess } from '~/components/workflow/hooks/use-workflow-access'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useWorkflowStore } from '~/components/workflow/store/workflow-store'
import { WorkflowBreadcrumbSwitcher } from '~/components/workflow/ui/workflow-breadcrumb-switcher'
import { useDockedPanels } from '~/hooks/use-docked-panels'
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

  // Anything the editor or the executions list wants to dock goes through ONE
  // target. The editor's panels (node properties, Test, Settings) are frames of
  // a single `WorkflowPanelDrawer` NavStack, and executions mode is a separate
  // tab, so there is never more than one consumer of this target.
  const hasPanelFrames = usePanelStore((state) => state.frames.length > 0)
  const panelOpen = mode === 'executions' || (mode === 'editor' && hasPanelFrames)

  const { dockedPanels } = useDockedPanels([
    { key: 'workflow-panel', open: panelOpen, content: <DockedPanelTarget /> },
  ])

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
