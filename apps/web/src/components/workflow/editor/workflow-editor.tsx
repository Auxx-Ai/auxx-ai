// apps/web/src/components/workflow/editor/workflow-editor.tsx

import React, { memo, useEffect, useRef } from 'react'
import { WorkflowStoreProvider } from '../store/workflow-store-provider'
import { WorkflowHistoryProvider } from '../store/workflow-history-provider'
import { WorkflowCanvas } from '../canvas/workflow-canvas'
import { WorkflowToolbar } from '../canvas/workflow-toolbar'
import { PropertyPanel } from '../panels/property-panel'
import { WorkflowRunPanel } from '../panels/run/workflow-run-panel'
import { WorkflowSettingsPanel } from '../panels/settings'
import { usePanelStore } from '../store/panel-store'
import { useWorkflowStore } from '../store/workflow-store'
import { WorkflowEditorProvider } from './workflow-editor-provider'
import { useWorkflowShortcuts } from '../hooks'
import { useWorkflowInit } from '../hooks'
import { useWorkflowBlocks } from '../hooks'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2 } from 'lucide-react'
import { ReactFlowProvider, type Viewport } from '@xyflow/react'
import { useTestInputSync } from '../store/test-input-store'
import { useWebhookTestStore } from '../store/webhook-test-store'
import type { FlowEdge, FlowNode } from '../types'
import { VarStoreSyncProvider, WorkflowResourceProvider } from '../providers'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Separator } from '@auxx/ui/components/separator'

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
      <div className="workflow-editor flex flex-col h-full rounded-2xl">
        {/* Toolbar */}
        <WorkflowToolbar className="flex-shrink-0" />

        {/* Main content */}
        <div className="flex-1 min-h-0 w-full flex flex-row">
          <WorkflowCanvas
            readOnly={readOnly}
            className="h-full flex-1 shrink-0"
            edges={initialEdges}
            nodes={initialNodes}
            initialViewport={initialViewport}
          />

          {/* Right sidebar - Properties/Variables/Debug */}
          {rightSidebarOpen && activePanel && <PropertyPanel className="h-full" />}

          {/* Run Panel */}
          {runPanelOpen && (
            <WorkflowRunPanel
              className="h-full border-l"
              workflowId={(workflow as any)?.workflowId}
              workflowAppId={workflow?.id}
            />
          )}

          {/* Settings Panel */}
          {settingsPanelOpen && (
            <WorkflowSettingsPanel
              className="h-full border-l"
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

    // Focus management
    useEffect(() => {
      if (containerRef.current) {
        containerRef.current.focus()
      }
    }, [])

    // Show loading state while fetching workflow data
    if (isLoading) {
      return (
        <div
          className={cn(
            'workflow-editor-container bg-background relative h-full outline-none flex flex-col',
            className
          )}>
          <div className="bg-primary-150 h-9 rounded-t-lg border-b border-primary-300 p-1 flex items-center gap-1">
            <Skeleton className="h-7 w-7" />
            <Separator orientation="vertical" className="h-6" />
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-7 w-[62px]" />
            <Separator orientation="vertical" className="h-6" />
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-7 w-[62px]" />
            <Skeleton className="h-7 w-[80px]" />
            <Skeleton className="h-7 w-[82px]" />
            <Separator orientation="vertical" className="h-6" />
            <Skeleton className="h-7 w-[78px]" />
            <Skeleton className="h-7 w-7" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">Loading workflow...</p>
            </div>
          </div>
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
          <div className="text-center max-w-md">
            <p className="text-sm text-red-600 mb-2">Failed to load workflow</p>
            <p className="text-xs text-muted-foreground">{error.message}</p>
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
