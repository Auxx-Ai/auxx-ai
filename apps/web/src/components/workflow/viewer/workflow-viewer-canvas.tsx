// apps/web/src/components/workflow/viewer/workflow-viewer-canvas.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import {
  Background,
  BackgroundVariant,
  type EdgeChange,
  MiniMap,
  type NodeChange,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Viewport,
} from '@xyflow/react'
import { Eye } from 'lucide-react'
import React, { useCallback, useEffect, useMemo } from 'react'
import CustomEdge from '~/components/workflow/edges/custom-edge'
import { FLOW_NODE_TYPES } from '~/components/workflow/nodes'
import type { FlowEdge, FlowNode } from '~/components/workflow/types'
import type { WorkflowViewerOptions } from './workflow-viewer'
import { WorkflowViewerOperators } from './workflow-viewer-operators'

const edgeTypes = { default: CustomEdge }

/**
 * Props for WorkflowViewerCanvas component
 */
interface WorkflowViewerCanvasProps {
  className?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  initialViewport?: Viewport | null
  options: Required<WorkflowViewerOptions>
}

/**
 * Read-only canvas component for the workflow viewer
 * Stripped down version of WorkflowCanvas with all editing disabled
 */
export const WorkflowViewerCanvas = React.memo<WorkflowViewerCanvasProps>(
  ({ className, nodes: initialNodes, edges: initialEdges, initialViewport, options }) => {
    const reactFlowInstance = useReactFlow()

    // State management for nodes and edges (enables selection)
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

    const nodeTypes = useMemo(() => FLOW_NODE_TYPES, [])

    // Sync props to state when they change externally
    useEffect(() => {
      setNodes(initialNodes)
    }, [initialNodes, setNodes])

    useEffect(() => {
      setEdges(initialEdges)
    }, [initialEdges, setEdges])

    // Handle nodes change - only allow selection changes
    const handleNodesChange = useCallback(
      (changes: NodeChange[]) => {
        const selectionChanges = changes.filter((change) => change.type === 'select')
        if (selectionChanges.length > 0) {
          onNodesChange(selectionChanges)
        }
      },
      [onNodesChange]
    )

    // Handle edges change - only allow selection changes
    const handleEdgesChange = useCallback(
      (changes: EdgeChange[]) => {
        const selectionChanges = changes.filter((change) => change.type === 'select')
        if (selectionChanges.length > 0) {
          onEdgesChange(selectionChanges)
        }
      },
      [onEdgesChange]
    )

    // Deselect all on pane click
    const handlePaneClick = useCallback(() => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: false })))
      setEdges((eds) => eds.map((e) => ({ ...e, selected: false })))
    }, [setNodes, setEdges])

    // Zoom handlers
    const handleFitView = useCallback(() => {
      reactFlowInstance.fitView({ padding: 0.1 })
    }, [reactFlowInstance])

    const handleZoomIn = useCallback(() => {
      reactFlowInstance.zoomIn({ duration: 200 })
    }, [reactFlowInstance])

    const handleZoomOut = useCallback(() => {
      reactFlowInstance.zoomOut({ duration: 200 })
    }, [reactFlowInstance])

    const proOptions = { hideAttribution: true }
    console.log('THEME:', options.theme)
    return (
      <div
        className={cn('workflow-viewer-canvas relative w-full h-full cursor-default', className)}>
        {/* Hide add node buttons, tooltips, and edge controls in viewer mode */}
        <style jsx global>{`
          .workflow-viewer-canvas .node-handle button,
          .workflow-viewer-canvas .node-handle > div:has(.text-muted-foreground) {
            opacity: 0 !important;
            pointer-events: none !important;
          }
          /* Hide edge add/delete buttons */
          .workflow-viewer-canvas .react-flow__edgelabel-renderer .nopan.nodrag {
            display: none !important;
          }
        `}</style>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onError={(code) => {
            if (code !== '008') console.warn('[ReactFlow] error', code)
          }}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={proOptions}
          // Editing disabled
          nodesDraggable={false}
          nodesConnectable={false}
          // Selection enabled
          elementsSelectable={true}
          selectNodesOnDrag={false}
          // Allow panning and zooming
          panOnDrag={true}
          panOnScroll={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          // Viewport - fitView on initial render
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
          // Styling
          className='bg-primary-50! '>
          {/* Background dots */}
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color={options.theme === 'dark' ? '#737881' : '#d4d4d8'}
          />

          {/* Minimap */}
          {options.showMinimap && (
            <MiniMap
              style={{ width: 102, height: 72 }}
              className={cn(
                'backdrop-blur-sm bg-white/40 dark:bg-primary-400/40 rounded-lg !left-4 z-[9] !m-0 !h-[72px] !w-[102px] !border-[0.5px] border-zinc-200 dark:border-primary-300 overflow-hidden',
                options.showNavigation ? '!bottom-14' : '!bottom-4'
              )}
              pannable
              zoomable
              bgColor={options.theme === 'dark' ? '#18181b' : '#fff'}
              nodeColor={options.theme === 'dark' ? '#a1a1aa' : '#e2e2e2'}
              nodeStrokeColor={options.theme === 'dark' ? '#52525b' : 'transparent'}
              maskColor={
                options.theme === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(240, 240, 240, 0.6)'
              }
            />
          )}

          {/* Top panel - Read-only badge */}
          <Panel position='top-left' className='space-y-2'>
            <Badge variant='zinc'>
              <Eye className='size-3 mr-1.5' />
              View Only
            </Badge>
          </Panel>

          {/* Bottom panel - Operators */}
          {options.showNavigation && (
            <Panel position='bottom-left'>
              <WorkflowViewerOperators
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onFitView={handleFitView}
              />
            </Panel>
          )}

          {/* Branding badge */}
          {options.showBranding && (
            <Panel position='bottom-right'>
              <a
                href='https://auxx.ai'
                target='_blank'
                rel='noopener noreferrer'
                className='text-xs text-muted-foreground hover:text-foreground transition-colors'>
                Built with Auxx.ai
              </a>
            </Panel>
          )}
        </ReactFlow>
      </div>
    )
  }
)

WorkflowViewerCanvas.displayName = 'WorkflowViewerCanvas'
