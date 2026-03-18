// apps/web/src/components/workflow/viewer/workflow-viewer.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { ReactFlowProvider, type Viewport } from '@xyflow/react'
import { Loader2 } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { setupNodeRegistry } from '../nodes/registry-setup'
import { useWorkflowStore } from '../store/workflow-store'
import type { FlowEdge, FlowNode } from '../types'
import { useWorkflowViewer, type WorkflowViewerData } from './hooks/use-workflow-viewer'
import { ViewerVarStoreSyncProvider } from './providers/viewer-var-store-sync-provider'
import { WorkflowViewerCanvas } from './workflow-viewer-canvas'
import { WorkflowViewerProvider } from './workflow-viewer-provider'

// Initialize node registry synchronously at module load
// This ensures all node definitions are available before any rendering
setupNodeRegistry()

/**
 * Display options for the workflow viewer
 */
export interface WorkflowViewerOptions {
  /** Show title header (default: true) */
  showTitle?: boolean
  /** Show minimap (default: true) */
  showMinimap?: boolean
  /** Show navigation/zoom controls (default: true) */
  showNavigation?: boolean
  /** Show branding badge (default: true) */
  showBranding?: boolean
  /** Theme override for isolated theming (default: 'light') */
  theme?: 'light' | 'dark'
}

/**
 * Props for the WorkflowViewer component
 */
interface WorkflowViewerProps {
  /** Workflow ID to fetch (fetch mode) */
  workflowId?: string
  /** Pre-loaded workflow data (data mode) */
  workflow?: WorkflowViewerData
  className?: string
  /** Theme override: 'light' | 'dark' | 'system' */
  theme?: 'light' | 'dark' | 'system'
  /** Display options */
  options?: WorkflowViewerOptions
  /** Initial viewport (overrides saved viewport) */
  initialViewport?: Viewport
  /** Callback when workflow loads */
  onLoad?: (workflow: { name: string; nodeCount: number }) => void
  /** Callback on error */
  onError?: (error: Error) => void
}

/**
 * Props for the inner viewer component
 */
interface WorkflowViewerInnerProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewport: Viewport | null
  workflowName: string
  options: Required<WorkflowViewerOptions>
}

/**
 * Inner viewer component that uses loaded workflow data
 */
const WorkflowViewerInner = memo<WorkflowViewerInnerProps>(
  ({ nodes, edges, viewport, workflowName, options }) => {
    return (
      <div className='workflow-viewer flex flex-col h-full'>
        {/* Header with workflow name */}
        {options.showTitle && (
          <div className='flex-shrink-0 px-4 py-2 border-b bg-background/80 backdrop-blur-sm'>
            <h2 className='text-sm font-medium truncate'>{workflowName}</h2>
          </div>
        )}

        {/* Canvas */}
        <WorkflowViewerCanvas
          nodes={nodes}
          edges={edges}
          initialViewport={viewport}
          options={options}
          className='flex-1'
        />
      </div>
    )
  }
)

WorkflowViewerInner.displayName = 'WorkflowViewerInner'

/**
 * Public embeddable workflow viewer
 *
 * Read-only view of a workflow with zoom/pan capabilities.
 * Designed for embedding in external sites or public sharing.
 */
/** Default display options */
const defaultOptions: Required<WorkflowViewerOptions> = {
  showTitle: true,
  showMinimap: true,
  showNavigation: true,
  showBranding: true,
  theme: 'light',
}

export const WorkflowViewer = memo<WorkflowViewerProps>(
  ({ workflowId, workflow, className, theme, options, initialViewport, onLoad, onError }) => {
    const containerRef = useRef<HTMLDivElement>(null)

    // Set viewer mode on mount, clear on unmount to disable save functionality
    useEffect(() => {
      useWorkflowStore.getState().setViewerMode(true)
      return () => {
        useWorkflowStore.getState().setViewerMode(false)
      }
    }, [])

    // Merge options with defaults, including theme prop
    const mergedOptions: Required<WorkflowViewerOptions> = {
      ...defaultOptions,
      ...options,
      ...(theme && { theme }), // Theme prop takes precedence
    }

    // Fetch or load workflow data
    const { nodes, edges, viewport, workflowName, environmentVariables, isLoading, error } =
      useWorkflowViewer({
        workflowId,
        workflow,
        initialViewport,
      })

    // Callback handlers
    useEffect(() => {
      if (!isLoading && !error && nodes) {
        onLoad?.({ name: workflowName || 'Workflow', nodeCount: nodes.length })
      }
    }, [isLoading, error, nodes, workflowName, onLoad])

    useEffect(() => {
      if (error) {
        onError?.(error)
      }
    }, [error, onError])

    // Loading state
    if (isLoading) {
      return (
        <div
          className={cn(
            'workflow-viewer-container h-full flex items-center justify-center bg-background',
            // mergedOptions.theme === 'dark' && 'dark',
            className
          )}>
          <div className='text-center'>
            <Loader2 className='w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>Loading workflow...</p>
          </div>
        </div>
      )
    }

    // Error state
    if (error) {
      return (
        <div
          className={cn(
            'workflow-viewer-container h-full flex items-center justify-center bg-background',
            mergedOptions.theme === 'dark' && 'dark',
            className
          )}>
          <div className='text-center max-w-md px-4'>
            <p className='text-sm text-destructive mb-2'>Failed to load workflow</p>
            <p className='text-xs text-muted-foreground'>{error.message}</p>
          </div>
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className={cn(
          'workflow-viewer-container relative h-full bg-background',
          mergedOptions.theme === 'dark' && 'dark',
          className
        )}>
        <ReactFlowProvider>
          <ViewerVarStoreSyncProvider environmentVariables={environmentVariables || []}>
            <WorkflowViewerProvider>
              <WorkflowViewerInner
                nodes={nodes || []}
                edges={edges || []}
                viewport={viewport}
                workflowName={workflowName || 'Workflow'}
                options={mergedOptions}
              />
            </WorkflowViewerProvider>
          </ViewerVarStoreSyncProvider>
        </ReactFlowProvider>
      </div>
    )
  }
)

WorkflowViewer.displayName = 'WorkflowViewer'
