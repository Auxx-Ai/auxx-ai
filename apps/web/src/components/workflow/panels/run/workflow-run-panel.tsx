// apps/web/src/components/workflow/panels/run/workflow-run-panel.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import { Popover, PopoverTrigger } from '@auxx/ui/components/popover'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import { Clock, ListChecks, Medal, Play, Route, TextCursorInput } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useDockPortal } from '~/components/global/dock-portal-provider'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import { useRunStore } from '~/components/workflow/store/run-store'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { RunHistory } from './run-history'
import { DetailTab } from './tabs/detail-tab'
import { InputTab } from './tabs/input-tab'
import { ResultTab } from './tabs/result-tab'
import { TracingTab } from './tabs/tracing-tab'

interface WorkflowRunPanelProps {
  className?: string
  workflowId?: string
  workflowAppId?: string
}

/**
 * Panel for running and testing workflows.
 * Supports both overlay (drawer) and docked modes via portal.
 */
export const WorkflowRunPanel = memo(function WorkflowRunPanel({
  className,
  workflowId,
  workflowAppId,
}: WorkflowRunPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false)

  const closeRunPanel = usePanelStore((state) => state.closeRunPanel)
  const runPanelTab = usePanelStore((state) => state.runPanelTab)
  const setRunPanelTab = usePanelStore((state) => state.setRunPanelTab)
  const panelWidth = usePanelStore((state) => state.getRunPanelWidth())
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

  // Determine if using secondary slot (side-by-side mode with property panel open)
  const useSecondarySlot = panelStack.includes('property') && layoutMode !== 'tabbed'

  // Use secondary slot if property panel is open and in side-by-side mode
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

  const activeRun = useRunStore((state) => state.activeRun)
  const isRunning = useRunStore((state) => state.isRunning)
  const executionProgress = useRunStore((state) => state.getExecutionProgress())
  const runViewMode = useRunStore((state) => state.runViewMode)

  // Safety check - don't render if not in panel stack
  if (panelWidth === 0) return null

  return (
    <DockableDrawer
      open={true}
      onOpenChange={(open) => !open && closeRunPanel()}
      isDocked={isDocked}
      width={isDocked ? currentDockedWidth : panelWidth}
      onWidthChange={handleWidthChange}
      minWidth={minWidth}
      maxWidth={maxWidth}
      title='Run Panel'
      portalTarget={portalRef}
      panelType='run'>
      <DrawerHeader
        icon={<Play className='size-4 text-muted-foreground' />}
        title='Test Workflow'
        onClose={closeRunPanel}
        actions={
          isRunning ? (
            <Badge
              variant='secondary'
              className='ml-1 h-5 px-2 text-xs font-normal border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950'>
              <div className='size-2 bg-blue-500 rounded-full animate-pulse mr-1.5' />
              <span className='text-blue-700 dark:text-blue-300'>
                Running... {executionProgress}%
              </span>
            </Badge>
          ) : undefined
        }
      />
      <div className='flex-1 flex-col flex min-h-0'>
        <Tabs
          value={runPanelTab}
          onValueChange={(value) => setRunPanelTab(value as any)}
          className='flex-1 flex flex-col min-h-0'>
          <div className='w-full border-b bg-secondary/20 backdrop-blur-sm'>
            <TabsList className='justify-start h-auto gap-1 rounded-none bg-primary-100 px-2 py-1 w-full'>
              {(runViewMode === 'single-node' || runViewMode === null) && (
                <TabsTrigger value='input' variant='outline' size='sm'>
                  <TextCursorInput className='size-3.5 mr-1.5 opacity-70' />
                  Input
                </TabsTrigger>
              )}
              <TabsTrigger value='result' variant='outline' disabled={!activeRun} size='sm'>
                <Medal className='size-3.5 mr-1.5 opacity-70' />
                Result
              </TabsTrigger>
              <TabsTrigger value='detail' variant='outline' disabled={!activeRun} size='sm'>
                <ListChecks className='size-3.5 mr-1.5 opacity-70' />
                Detail
              </TabsTrigger>
              <TabsTrigger value='tracing' variant='outline' disabled={!activeRun} size='sm'>
                <Route className='size-3.5 mr-1.5 opacity-70' />
                Tracing
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value='input' className='flex-1 min-h-0 overflow-hidden p-0 m-0'>
            <ScrollArea
              className='h-full'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              <InputTab workflowId={workflowId} workflowAppId={workflowAppId} />
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value='result'
            className='flex-1 min-h-0 overflow-hidden p-0 m-0 flex-col flex'>
            <ScrollArea
              className='h-full'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              <ResultTab />
            </ScrollArea>
          </TabsContent>

          <TabsContent value='detail' className='flex-1 min-h-0 overflow-hidden p-0 m-0'>
            <ScrollArea
              className='h-full'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              <div className='p-3'>
                <div className='rounded-lg border-[0.5px] border-border bg-secondary/10 p-4'>
                  <DetailTab />
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value='tracing' className='flex-1 min-h-0 overflow-hidden p-0 m-0'>
            <ScrollArea
              className='h-full'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              <div className='p-3'>
                <TracingTab />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>

      {/* Status bar */}
      <div className='p-3 border-t backdrop-blur-sm bg-secondary/20 dark:bg-black/20 rounded-b-xl'>
        <div className='flex items-center justify-between'>
          <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-auto px-2 py-1 text-xs font-mono hover:bg-secondary/50'>
                <Clock className='size-3 mr-1' />
                {activeRun ? `Run #${activeRun.sequenceNumber}` : 'Run History'}
              </Button>
            </PopoverTrigger>
            <RunHistory onRunSelect={() => setHistoryOpen(false)} />
          </Popover>
          {activeRun && (
            <div className='flex items-center gap-2'>
              <div
                className={cn(
                  'size-2 rounded-full',
                  activeRun.status === 'SUCCEEDED' && 'bg-green-500',
                  activeRun.status === 'FAILED' && 'bg-red-500',
                  activeRun.status === 'RUNNING' && 'bg-blue-500 animate-pulse',
                  activeRun.status === 'STOPPED' && 'bg-orange-500'
                )}
              />
              <span
                className={cn(
                  'text-xs font-medium',
                  activeRun.status === 'SUCCEEDED' && 'text-green-600 dark:text-green-400',
                  activeRun.status === 'FAILED' && 'text-red-600 dark:text-red-400',
                  activeRun.status === 'RUNNING' && 'text-blue-600 dark:text-blue-400',
                  activeRun.status === 'STOPPED' && 'text-orange-600 dark:text-orange-400'
                )}>
                {activeRun.status}
              </span>
            </div>
          )}
        </div>
      </div>
    </DockableDrawer>
  )
})
