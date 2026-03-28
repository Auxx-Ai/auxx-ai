// apps/web/src/components/workflow/canvas/workflow-canvas.tsx

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  type Viewport,
} from '@xyflow/react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'

// import '@xyflow/react/dist/style.css'
// import { DevTools } from '~/components/devtools'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { Eye } from 'lucide-react'
import { useTheme } from 'next-themes'
import CustomEdge from '~/components/workflow/edges/custom-edge'
import CustomConnectionLine from '~/components/workflow/edges/custom-edge/custom-connection-line'
import {
  useCanvasActions,
  useCanvasSettings,
  useEdgeInteractions,
  useEdgeStatusUpdater,
  useNodesInteractions,
  useNodeValidation,
  useSelectionInteractions,
  useWorkflowRunNodeSync,
  useWorkflowSave,
} from '~/components/workflow/hooks'
import { FLOW_NODE_TYPES } from '~/components/workflow/nodes'
import { useCanvasStore } from '~/components/workflow/store/canvas-store'
import { storeEventBus } from '~/components/workflow/store/event-bus'
import { useInteractionStore } from '~/components/workflow/store/interaction-store'
import { usePanelStore } from '~/components/workflow/store/panel-store'
import type { FlowEdge, FlowNode } from '~/components/workflow/types'
import { EmptyTriggerButton } from '~/components/workflow/ui/empty-trigger-button'
import { GettingStartedOverlay } from '~/components/workflow/ui/getting-started-overlay'
import HelpLine from '~/components/workflow/ui/helpline'
import { createCenterOnNodeHandler } from '~/components/workflow/utils'
import { useContextMenu } from '../hooks/use-context-menu'
import { CanvasNodeInfo } from '../ui/canvas-node-info'
import { NodeContextMenu } from '../ui/node-context-menu'
import { PaneContextMenu } from '../ui/pane-context-menu'
import { RunInfo } from '../ui/run-info'
import { WorkflowOperators } from './workflow-operators'

// Context to provide canvas state to operations hooks
// Removed unused CanvasStateContext - was causing performance issues
// by memoizing nodes/edges which change constantly, forcing re-renders
// of all consumers. The context was exported but never actually used.

// Custom edge types
const edgeTypes = { default: CustomEdge }

interface WorkflowCanvasProps {
  className?: string
  readOnly?: boolean
  edges: FlowEdge[]
  nodes: FlowNode[]
  initialViewport?: Viewport | null
}

/**
 * Main workflow canvas component
 * Memoized to prevent unnecessary re-renders
 */
const WorkflowCanvasInner = React.memo<WorkflowCanvasProps>(
  ({
    className,
    readOnly: propReadOnly = false,
    edges: initialEdges,
    nodes: initialNodes,
    initialViewport,
  }) => {
    const reactFlowInstance = useReactFlow()
    const { theme } = useTheme()

    // Get read-only state from canvas store (overrides prop)
    const canvasReadOnly = useCanvasStore((state) => state.readOnly)
    const versionPreviewData = useCanvasStore((state) => state.versionPreviewData)

    // Determine final read-only state
    const readOnly = propReadOnly || canvasReadOnly

    // Help overlay state
    const helpOverlayOpen = usePanelStore((state) => state.helpOverlayOpen)
    const setHelpOverlayOpen = usePanelStore((state) => state.setHelpOverlayOpen)

    // Use only FLOW_NODE_TYPES - StandardNode handles dynamic lookup
    const nodeTypes = useMemo(() => FLOW_NODE_TYPES, [])

    // Get initial data from editor provider
    const { debouncedSave } = useWorkflowSave()

    // Edge status updater - monitors node status changes and updates edge colors
    useEdgeStatusUpdater()
    // Workflow run node sync - syncs node statuses when workflow runs
    useWorkflowRunNodeSync()

    // Edge interactions - handles edge hover states and changes
    const { handleEdgeEnter, handleEdgeLeave, handleEdgesChange } = useEdgeInteractions()
    const { isValidConnection } = useNodeValidation()
    // Node interactions - handles node hover states and drag operations
    const {
      handleNodeEnter,
      handleNodeClick,
      handleNodeLeave,
      handleNodeDrag,
      handleNodeDragStart,
      handleNodeDragStop,
      handlePaneClick,
      handleNodeConnect,
      handleNodeConnectStart,
      handleNodeConnectEnd,
      // handleNodeChange,
    } = useNodesInteractions()

    // Node store for handling ReactFlow node changes (especially deletions)

    const { handleSelectionStart, handleSelectionChange, handleSelectionDrag } =
      useSelectionInteractions()

    // Context menu handlers
    const { handleNodeContextMenu, handlePaneContextMenu } = useContextMenu()

    // Initialize ReactFlow state
    // const initialNodes = getInitialNodes()
    // const initialEdges = getInitialEdges()
    const [nodes, setNodes] = useNodesState(initialNodes)
    const [edges, setEdges] = useEdgesState(initialEdges)

    // Ref for debouncing viewport changes
    const viewportTimeoutRef = useRef<NodeJS.Timeout>()

    // Memoize counts
    const nodeCount = useMemo(() => nodes.length, [nodes.length])
    const edgeCount = useMemo(() => edges.length, [edges.length])

    // Subscribe to node:updated events to sync data changes (like disabled state)
    useEffect(() => {
      const handleNodeUpdated = ({ data }: any) => {
        if (!data) return
        const { nodeId, updates } = data

        // If the update includes data changes (like disabled), sync to React Flow
        if (updates?.data) {
          setNodes((prevNodes) =>
            prevNodes.map((node) =>
              node.id === nodeId ? { ...node, data: { ...node.data, ...updates.data } } : node
            )
          )
        }
      }

      const unsubscribe = storeEventBus.on('node:updated', handleNodeUpdated)

      return unsubscribe
    }, [setNodes])

    // Subscribe to external workflow updates
    useEffect(() => {
      const handleExternalUpdate = (event: any) => {
        // Update nodes if provided
        if (event.data?.nodes) {
          setNodes(event.data.nodes)
        }

        // Update edges if provided
        if (event.data?.edges) {
          setEdges(event.data.edges)
        }

        // Update viewport if provided
        if (event.data?.viewport && reactFlowInstance) {
          reactFlowInstance.setViewport(event.data.viewport)
        }
      }

      // Subscribe to workflow data updates from external sources
      const unsubscribe = storeEventBus.on('workflow:externalUpdate', handleExternalUpdate)

      return unsubscribe
    }, [setNodes, setEdges, reactFlowInstance])

    // Canvas store hooks (re-enabled)
    const { snapToGrid, gridSize, showGrid, showMinimap } = useCanvasSettings()
    const { setViewport } = useCanvasActions()

    // Get interaction settings from the interaction store
    const interactionSettings = useInteractionStore((state) => state.settings)

    // Default viewport - use prop if provided, otherwise fallback to default
    const defaultViewport = useMemo(
      () => initialViewport ?? { x: 0, y: 0, zoom: 0.7 },
      [initialViewport]
    )

    // Initialize canvas store with initial viewport on mount
    useEffect(() => {
      if (initialViewport) {
        setViewport(initialViewport)
      }
    }, [initialViewport, setViewport])

    // Initialize node types

    // Memoized event handlers to prevent unnecessary re-renders
    const handleFitView = useCallback(() => {
      reactFlowInstance.fitView({ padding: 0.1 })
    }, [reactFlowInstance])

    const handleZoomIn = useCallback(() => {
      reactFlowInstance.zoomIn({ duration: 200 })
    }, [reactFlowInstance])

    const handleZoomOut = useCallback(() => {
      reactFlowInstance.zoomOut({ duration: 200 })
    }, [reactFlowInstance])

    // Create the handler using the utility
    const handleCenterOnNode = useMemo(
      () => createCenterOnNodeHandler(() => reactFlowInstance!),
      [reactFlowInstance]
    )

    // Handle viewport changes with debouncing to prevent re-renders during drag
    const debouncedSetViewport = useCallback(
      (viewport: any) => {
        if (viewportTimeoutRef.current) {
          clearTimeout(viewportTimeoutRef.current)
        }
        viewportTimeoutRef.current = setTimeout(() => {
          setViewport(viewport)
          // Trigger save after viewport change
          debouncedSave()
        }, 300) // Debounce viewport updates by 300ms
      },
      [setViewport, debouncedSave]
    )

    useOnViewportChange({ onChange: debouncedSetViewport })

    // Custom event listeners for workflow-specific operations
    useEffect(() => {
      // Add workflow-specific event listeners (these are triggered programmatically, not by keyboard)
      window.addEventListener('workflow:fitView', handleFitView)
      window.addEventListener('workflow:zoomIn', handleZoomIn)
      window.addEventListener('workflow:zoomOut', handleZoomOut)
      window.addEventListener('workflow:centerOnNode', handleCenterOnNode)

      // Cleanup event listeners
      return () => {
        window.removeEventListener('workflow:fitView', handleFitView)
        window.removeEventListener('workflow:zoomIn', handleZoomIn)
        window.removeEventListener('workflow:zoomOut', handleZoomOut)
        window.removeEventListener('workflow:centerOnNode', handleCenterOnNode)
      }
    }, [handleFitView, handleZoomIn, handleZoomOut, handleCenterOnNode])

    // Note: Keyboard shortcuts have been moved to use-workflow-shortcuts.ts for centralized management

    const proOptions = { hideAttribution: true }

    return (
      <div
        className={cn(
          'workflow-canvas relative w-full h-full',
          readOnly && 'cursor-default',
          className
        )}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onError={(code) => {
            if (code !== '008') console.warn('[ReactFlow] error', code)
          }}
          deleteKeyCode={null}
          // onNodesChange={}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={readOnly ? undefined : handleNodeConnect}
          onConnectStart={readOnly ? undefined : handleNodeConnectStart}
          onConnectEnd={readOnly ? undefined : handleNodeConnectEnd}
          onSelectionStart={handleSelectionStart}
          onSelectionChange={handleSelectionChange}
          onSelectionDrag={handleSelectionDrag}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          // onNodesChange={handleNodeChange}
          onNodeDragStart={readOnly ? undefined : handleNodeDragStart}
          onNodeDrag={readOnly ? undefined : handleNodeDrag}
          onNodeDragStop={readOnly ? undefined : handleNodeDragStop}
          onNodeMouseEnter={handleNodeEnter}
          onNodeMouseLeave={handleNodeLeave}
          onEdgeMouseEnter={handleEdgeEnter}
          onEdgeMouseLeave={handleEdgeLeave}
          onEdgesChange={readOnly ? undefined : handleEdgesChange}
          onNodeContextMenu={handleNodeContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          connectionLineComponent={CustomConnectionLine}
          proOptions={proOptions}
          isValidConnection={isValidConnection}
          // Interaction settings (already adjusted for read-only mode)
          panOnDrag={interactionSettings.panOnDrag}
          panOnScroll={interactionSettings.panOnScroll}
          selectionOnDrag={interactionSettings.selectionOnDrag}
          nodesDraggable={interactionSettings.nodesDraggable}
          nodesConnectable={interactionSettings.nodesConnectable}
          elementsSelectable={interactionSettings.elementsSelectable}
          // Disable deselection on pane click when pinned
          selectNodesOnDrag={false}
          // Grid settings
          snapToGrid={snapToGrid}
          snapGrid={[gridSize, gridSize]}
          // Connection settings
          connectionMode={ConnectionMode.Loose}
          // Selection settings
          selectionMode={SelectionMode.Partial}
          // Viewport
          minZoom={0.1}
          defaultViewport={defaultViewport}
          // Styling
          attributionPosition='bottom-left'
          className={cn('bg-primary-50 ', readOnly && 'opacity-95')}>
          {/* <DevTools position="top-left" /> */}
          {/* Background */}
          {showGrid && (
            <Background
              variant={BackgroundVariant.Dots}
              gap={gridSize}
              size={1}
              color={theme === 'dark' ? '#737881' : '#d4d4d8'}
            />
          )}

          {/* Minimap */}
          {showMinimap && (
            <MiniMap
              style={{ width: 102, height: 72 }}
              className='backdrop-blur-sm bg-white/40 dark:bg-primary-400/40 rounded-lg !bottom-14 !left-4 z-[9] !m-0 !h-[72px] !w-[102px] !border-[0.5px] border-zinc-200 dark:border-primary-300 overflow-hidden'
              pannable
              zoomable
              bgColor={theme === 'dark' ? '#18181b' : '#fff'}
              nodeColor={theme === 'dark' ? '#a1a1aa' : '#e2e2e2'}
              nodeStrokeColor={theme === 'dark' ? '#52525b' : 'transparent'}
              maskColor={theme === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(240, 240, 240, 0.6)'}
            />
          )}

          {/* Custom panels */}
          <Panel position='top-left' className='space-y-2 flex flex-row space-x-2'>
            {/* Empty trigger button — hidden when getting started overlay is showing */}
            {!readOnly && nodeCount > 0 && <EmptyTriggerButton />}
            <RunInfo />
            {readOnly && (
              <div>
                <Badge variant='zinc'>
                  <Eye className='size-3 mr-1.5' />
                  Read Only
                  {versionPreviewData && (
                    <span className='ml-1 text-xs'>- {versionPreviewData.title}</span>
                  )}
                </Badge>
              </div>
            )}
          </Panel>

          {/* Empty trigger button - only show in edit mode */}

          {/* Workflow operators panel - bottom left */}
          <Panel position='bottom-left'>
            <WorkflowOperators />
          </Panel>
          <CanvasNodeInfo />
        </ReactFlow>

        {/* Context menus - single instance each */}
        <NodeContextMenu />
        <PaneContextMenu />

        {/* Helplines for alignment - positioned outside ReactFlow for proper coordinate system */}
        <HelpLine />

        {/* Getting started overlay — auto mode (empty canvas) or manual mode (help button) */}
        <GettingStartedOverlay open={helpOverlayOpen} onClose={() => setHelpOverlayOpen(false)} />
      </div>
    )
  }
  // (prevProps, nextProps) => {
  //   // Custom comparison - return true if props are equal (should NOT re-render)
  //   return (
  //     prevProps.className === nextProps.className &&
  //     prevProps.readOnly === nextProps.readOnly &&
  //     prevProps.nodes === nextProps.nodes &&
  //     prevProps.edges === nextProps.edges
  //   )
  // }
)

WorkflowCanvasInner.displayName = 'WorkflowCanvasInner'

/**
 * Workflow canvas with ReactFlow provider
 * Memoized to prevent re-renders when props haven't changed
 */
export const WorkflowCanvas = React.memo<WorkflowCanvasProps>((props) => {
  return <WorkflowCanvasInner {...props} />
})

WorkflowCanvas.displayName = 'WorkflowCanvas'
