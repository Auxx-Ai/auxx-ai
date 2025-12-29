// apps/web/src/app/(protected)/app/workflows/_components/executions/workflow-execution-detail-drawer.tsx

'use client'

import { useState, useEffect } from 'react'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { OverflowTabsList, Tabs, TabsContent } from '@auxx/ui/components/tabs'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { useDockPortal } from '~/components/global/dock-portal-provider'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { useRunStore } from '~/components/workflow/store/run-store'
import { EntityIcon } from '~/components/pickers/icon-picker'
import { api } from '~/trpc/react'

// Reuse existing tabs (that don't require workflow editor providers)
import { ResultTab } from '~/components/workflow/panels/run/tabs/result-tab'
import { DetailTab } from '~/components/workflow/panels/run/tabs/detail-tab'
import { ExecutionTracingView } from './execution-tracing-view'

import { Medal, ListChecks, Route, Loader2 } from 'lucide-react'
import { WorkflowRunStatusBadge } from './workflow-run-status-badge'
import type { WorkflowRunEntity } from '@auxx/database/models'

interface WorkflowExecutionDetailDrawerProps {
  run: WorkflowRunEntity
  workflowId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Drawer component for viewing workflow execution details.
 * Reuses existing tabs from the workflow run panel.
 */
export function WorkflowExecutionDetailDrawer({
  run,
  workflowId,
  open,
  onOpenChange,
}: WorkflowExecutionDetailDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const { primaryPanelRef } = useDockPortal()
  const [activeTab, setActiveTab] = useState('detail')

  // Store actions
  const showPrevious = useRunStore((state) => state.showPrevious)
  const clearRun = useRunStore((state) => state.clearRun)

  // Fetch complete run data with node executions
  const { data: completeRun, isLoading } = api.workflow.getWorkflowRun.useQuery(
    { runId: run.id },
    { enabled: open }
  )

  // Load run into store when data is fetched
  useEffect(() => {
    if (completeRun && open) {
      showPrevious(completeRun as any)
    }
  }, [completeRun, open, showPrevious])

  // Clear store when drawer closes
  useEffect(() => {
    if (!open) {
      clearRun()
    }
  }, [open, clearRun])

  return (
    <DockableDrawer
      open={open}
      onOpenChange={onOpenChange}
      isDocked={isDocked}
      width={dockedWidth}
      onWidthChange={setDockedWidth}
      minWidth={350}
      maxWidth={600}
      portalTarget={primaryPanelRef}
      title={`Workflow Run #${run.sequenceNumber}`}>
      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col rounded-t-xl">
        {/* Header */}
        <DrawerHeader
          icon={<EntityIcon iconId="activity" color="purple" className="size-6" />}
          title={
            <div className="flex items-center gap-2">
              <span className="font-medium">Run #{run.sequenceNumber}</span>
              <WorkflowRunStatusBadge status={run.status} />
            </div>
          }
          onClose={() => onOpenChange(false)}
          actions={<DockToggleButton />}
        />

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Tabs - reusing existing components */}
        {!isLoading && completeRun && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <OverflowTabsList
              tabs={[
                { value: 'detail', label: 'Details', icon: ListChecks },
                { value: 'result', label: 'Result', icon: Medal },
                { value: 'tracing', label: 'Tracing', icon: Route },
              ]}
              value={activeTab}
              onValueChange={setActiveTab}
              variant="outline"
            />

            <TabsContent value="detail" className="flex-1 overflow-auto p-4">
              <div className="rounded-lg border bg-secondary/10 p-4">
                <DetailTab />
              </div>
            </TabsContent>

            <TabsContent value="result" className="flex-1 overflow-auto">
              <ResultTab />
            </TabsContent>

            <TabsContent value="tracing" className="flex-1 overflow-auto p-3">
              <ExecutionTracingView />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DockableDrawer>
  )
}
