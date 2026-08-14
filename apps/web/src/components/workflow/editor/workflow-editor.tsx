// apps/web/src/components/workflow/editor/workflow-editor.tsx

import Loader from '@auxx/ui/components/loader'
import { Separator } from '@auxx/ui/components/separator'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { ReactFlowProvider, type Viewport } from '@xyflow/react'
import { memo, useEffect, useRef } from 'react'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { WorkflowCanvas } from '../canvas/workflow-canvas'
import { WorkflowToolbar } from '../canvas/workflow-toolbar'
import {
  useEagerAppOutputs,
  useRunDeepLink,
  useWorkflowAccess,
  useWorkflowBlocks,
  useWorkflowDraftRealtime,
  useWorkflowInit,
  useWorkflowShortcuts,
} from '../hooks'
import { PropertyPanel } from '../panels/property-panel'
import { WorkflowRunPanel } from '../panels/run/workflow-run-panel'
import { WorkflowSettingsPanel } from '../panels/settings'
import { VarStoreSyncProvider, WorkflowResourceProvider } from '../providers'
import { usePanelStore } from '../store/panel-store'
import { useTestInputSync } from '../store/test-input-store'
import { useWebhookTestStore } from '../store/webhook-test-store'
import { WorkflowHistoryProvider } from '../store/workflow-history-provider'
import { useWorkflowStore } from '../store/workflow-store'
import { WorkflowStoreProvider } from '../store/workflow-store-provider'
import type { FlowEdge, FlowNode } from '../types'
import { WorkflowEditorProvider } from './workflow-editor-provider'

interface WorkflowEditorProps {
  workflowId: string
  className?: string
  readOnly?: boolean
}

/**
 * Inner editor component that uses the workflow stores
 */
const WorkflowEditorInner = memo<{
  readOnly?: boolean
  workflowId: string
  initialNodes: FlowNode[]
  initialEdges: FlowEdge[]
  initialViewport?: Viewport | null
}>(({ readOnly = false, workflowId, initialNodes, initialEdges, initialViewport }) => {
  const workflow = useWorkflowStore((state) => state.workflow)
  const activePanel = usePanelStore((state) => state.activePanel)
  const rightSidebarOpen = usePanelStore((state) => state.rightSidebarOpen)
  const runPanelOpen = usePanelStore((state) => state.runPanelOpen)
  const settingsPanelOpen = usePanelStore((state) => state.settingsPanelOpen)

  // Load workflow blocks from installed apps (side effect only)
  useWorkflowBlocks()

  // Eagerly fetch computed outputs for app nodes (e.g., Shopify)
  useEagerAppOutputs()

  // Rehydrate a historical run from the `runId` URL param (survives remounts)
  useRunDeepLink()

  // Rehydrate the canvas when the draft changes server-side (Kopilot graph
  // mutations / turn reverts publish `workflow:draft-updated`)
  useWorkflowDraftRealtime()

  // Initialize test input sync
  useTestInputSync()

  // Clean up webhook test listeners on unmount
  const stopListening = useWebhookTestStore((state) => state.stopListening)
  useEffect(() => {
    return () => {
      stopListening(workflowId)
    }
  }, [workflowId, stopListening])

  return (
    <>
      <WorkflowKeyboardShortcuts />
      <div className='workflow-editor flex flex-col h-full rounded-2xl'>
        {/* Toolbar */}
        <WorkflowToolbar className='flex-shrink-0' />

        {/* Main content */}
        <div className='flex-1 min-h-0 w-full flex flex-row'>
          <WorkflowCanvas
            readOnly={readOnly}
            className='h-full flex-1 shrink-0'
            edges={initialEdges}
            nodes={initialNodes}
            initialViewport={initialViewport}
          />

          {/* Right sidebar - Properties/Variables/Debug */}
          {rightSidebarOpen && activePanel && <PropertyPanel className='h-full' />}

          {/* Run Panel */}
          {runPanelOpen && (
            <WorkflowRunPanel
              className='h-full border-l'
              workflowId={(workflow as any)?.workflowId}
              workflowAppId={workflow?.id}
            />
          )}

          {/* Settings Panel */}
          {settingsPanelOpen && (
            <WorkflowSettingsPanel
              className='h-full border-l'
              workflowId={(workflow as any)?.workflowId}
              workflowAppId={workflow?.id}
            />
          )}
        </div>
      </div>
    </>
  )
})

WorkflowEditorInner.displayName = 'WorkflowEditorInner'

/**
 * Component that initializes keyboard shortcuts inside the WorkflowEditorProvider
 */
const WorkflowKeyboardShortcuts = memo(() => {
  useWorkflowShortcuts()
  return null
})

WorkflowKeyboardShortcuts.displayName = 'WorkflowKeyboardShortcuts'

/**
 * Main workflow editor component with store provider
 */
export const WorkflowEditor = memo<WorkflowEditorProps>(
  ({ workflowId, className, readOnly = false }) => {
    const containerRef = useRef<HTMLDivElement>(null)

    // Initialize workflow data
    const { nodes, edges, viewport, isLoading, error } = useWorkflowInit({ workflowId })

    // Per-workflow instance access (plan 30 §4). The route param IS the
    // `WorkflowApp.id`, so this resolves before the workflow fetch returns.
    const { canView, canEdit } = useWorkflowAccess(workflowId)
    const setInstanceReadOnly = useWorkflowStore((state) => state.setInstanceReadOnly)

    /**
     * Publish the `view`-without-`edit` clamp into the store so `useReadOnly()`
     * — and through it the whole canvas, every node panel, and `useWorkflowSave`
     * — sees it. Cleared on unmount because the workflow stores are module-level
     * singletons: a restricted workflow must not leave the next one read-only.
     */
    useEffect(() => {
      setInstanceReadOnly(!canEdit)
      return () => setInstanceReadOnly(false)
    }, [canEdit, setInstanceReadOnly])

    // Focus management
    useEffect(() => {
      if (containerRef.current) {
        containerRef.current.focus()
      }
    }, [])

    // Restricted to `none` on this workflow — the server 403s every read anyway,
    // so show the permission surface instead of a "failed to load" error.
    if (!canView) {
      return (
        <div className={cn('workflow-editor-container relative h-full outline-none', className)}>
          <NoAccess area='this workflow' backHref='/app/workflows' backLabel='Back to workflows' />
        </div>
      )
    }

    // Show loading state while fetching workflow data
    if (isLoading) {
      return (
        <div
          className={cn(
            'workflow-editor-container bg-background relative h-full outline-none flex flex-col',
            className
          )}>
          <div className='bg-primary-150 h-9 rounded-t-lg border-b border-primary-300 p-1 flex items-center gap-1'>
            <Skeleton className='h-7 w-7' />
            <Separator orientation='vertical' className='h-6' />
            <Skeleton className='h-7 w-7' />
            <Skeleton className='h-7 w-[62px]' />
            <Separator orientation='vertical' className='h-6' />
            <Skeleton className='h-7 w-7' />
            <Skeleton className='h-7 w-[62px]' />
            <Skeleton className='h-7 w-[80px]' />
            <Skeleton className='h-7 w-[82px]' />
            <Separator orientation='vertical' className='h-6' />
            <Skeleton className='h-7 w-[78px]' />
            <Skeleton className='h-7 w-7' />
          </div>
          <Loader size='sm' title='Loading workflow...' subtitle='Please wait' />
        </div>
      )
    }

    // Show error state if workflow failed to load
    if (error) {
      return (
        <div
          className={cn(
            'workflow-editor-container relative h-full outline-none flex items-center justify-center',
            className
          )}>
          <div className='text-center max-w-md'>
            <p className='text-sm text-red-600 mb-2'>Failed to load workflow</p>
            <p className='text-xs text-muted-foreground'>{error.message}</p>
          </div>
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className={cn('workflow-editor-container relative h-full outline-none', className)}
        tabIndex={-1}>
        <ReactFlowProvider>
          <WorkflowResourceProvider>
            <VarStoreSyncProvider>
              <WorkflowEditorProvider>
                <WorkflowStoreProvider workflowId={workflowId} initialViewport={viewport}>
                  <WorkflowHistoryProvider>
                    <WorkflowEditorInner
                      initialNodes={nodes || []}
                      initialEdges={edges || []}
                      initialViewport={viewport}
                      readOnly={readOnly}
                      workflowId={workflowId}
                    />
                  </WorkflowHistoryProvider>
                </WorkflowStoreProvider>
              </WorkflowEditorProvider>
            </VarStoreSyncProvider>
          </WorkflowResourceProvider>
        </ReactFlowProvider>
      </div>
    )
  }
)

WorkflowEditor.displayName = 'WorkflowEditor'
