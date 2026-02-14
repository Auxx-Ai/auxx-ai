// apps/web/src/components/workflow/edges/custom-edge/index.tsx

import { cn } from '@auxx/ui/lib/utils'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, useReactFlow } from '@xyflow/react'
import { Plus, Trash2 } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useAvailableBlocks, useEdgeInteractions } from '~/components/workflow/hooks'
import { unifiedNodeRegistry } from '~/components/workflow/nodes/unified-registry'
import type { EdgeData } from '~/components/workflow/types'
import { NodeRunningStatus } from '~/components/workflow/types'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import {
  EDGE_ROUTING,
  EDGE_STROKE_WIDTH,
  EDGE_STROKE_WIDTH_HOVER,
  EDGE_STROKE_WIDTH_SELECTED,
} from '../constants'
import { CustomEdgeLinearGradient } from './linear-gradient'
import { getAdaptiveEdgePath } from './path-utils'
import { getEdgeColor, shouldShowGradient } from './utils'

/**
 * Custom edge component with visual status indicators and node insertion capability
 * - Shows gradient based on node running status
 * - Allows inserting nodes by clicking on the edge
 * - Highlights error branches in red
 * - Provides smooth hover animations
 */

const CustomEdge = memo<EdgeProps>(
  ({
    id,
    data,
    source,
    sourceHandleId,
    target,
    targetHandleId,
    sourceX,
    sourceY,
    targetX,
    targetY,
    selected = false,
  }: EdgeProps) => {
    // Type guard for edge data with stable defaults
    const edgeData = useMemo(() => {
      const defaultData: EdgeData = {
        sourceType: '',
        targetType: '',
        isInIteration: false,
        isInLoop: false,
        _sourceRunningStatus: undefined,
        _targetRunningStatus: undefined,
        _hovering: false,
        _connectedNodeIsHovering: false,
        _waitingRun: false,
      }
      return { ...defaultData, ...(data || {}) } as EdgeData
    }, [data])

    const [triggerOpen, setTriggerOpen] = useState(false)
    const { getNode } = useReactFlow()
    const { handleEdgeDelete } = useEdgeInteractions()

    const isHovering = edgeData._hovering || false
    const isLoopEdge = edgeData?.isLoopBackEdge || sourceHandleId === 'loop-back'

    // Use stable values for hooks to prevent re-ordering issues
    const targetType = edgeData.targetType || ''
    const sourceType = edgeData.sourceType || ''
    const isInIteration = edgeData.isInIteration || false
    const isInLoop = edgeData.isInLoop || false

    const { availablePrevBlocks } = useAvailableBlocks(targetType, isInLoop, 'target')
    const { availableNextBlocks } = useAvailableBlocks(sourceType, isInLoop, 'source')

    // Get source node for anchor
    const sourceNode = getNode(source)

    // Check if source node is an input node
    const isInput = unifiedNodeRegistry.isInputNode(sourceType)

    // Calculate adaptive edge path - uses n8n-style routing for backward edges
    const {
      path: edgePath,
      labelX,
      labelY,
    } = useMemo(() => {
      return getAdaptiveEdgePath({
        sourceX: sourceX - 8,
        sourceY,
        targetX: targetX + 8,
        targetY,
      })
    }, [sourceX, sourceY, targetX, targetY])

    // Check if this is a backward edge
    const isBackwardEdge = targetX < sourceX - EDGE_ROUTING.BACKWARD_THRESHOLD

    // Fixed distance between buttons
    const buttonSpacing = 24

    // Position buttons based on edge type
    const { addButtonX, addButtonY, deleteButtonX, deleteButtonY } = useMemo(() => {
      if (isBackwardEdge) {
        // Backward edge: buttons are on horizontal segment, space them horizontally
        return {
          addButtonX: labelX - buttonSpacing / 2,
          addButtonY: labelY,
          deleteButtonX: labelX + buttonSpacing / 2,
          deleteButtonY: labelY,
        }
      } else {
        // Forward edge: use angle-based positioning along the curve
        const edgeAngle = Math.atan2(targetY - sourceY, targetX - sourceX)
        return {
          addButtonX: labelX - (buttonSpacing / 2) * Math.cos(edgeAngle),
          addButtonY: labelY - (buttonSpacing / 2) * Math.sin(edgeAngle),
          deleteButtonX: labelX + (buttonSpacing / 2) * Math.cos(edgeAngle),
          deleteButtonY: labelY + (buttonSpacing / 2) * Math.sin(edgeAngle),
        }
      }
    }, [isBackwardEdge, labelX, labelY, sourceX, sourceY, targetX, targetY, buttonSpacing])

    const { _sourceRunningStatus, _targetRunningStatus, _hovering } = edgeData

    // Determine if gradient should be shown
    const showGradient = useMemo(() => {
      return shouldShowGradient(_sourceRunningStatus, _targetRunningStatus)
    }, [_sourceRunningStatus, _targetRunningStatus])

    const linearGradientId = showGradient ? id : undefined

    // Memoize error branch check to avoid repeated calculations
    const isErrorBranch = useMemo(() => {
      return sourceHandleId === 'false' || sourceHandleId === 'fail'
    }, [sourceHandleId])

    // Determine stroke color
    const stroke = useMemo(() => {
      // if (isLoopEdge) {
      //   return '#8B5CF6' // Purple for loop edges
      // }

      if (isInput) {
        return getEdgeColor(NodeRunningStatus.Exception)
      }

      if (selected) {
        return getEdgeColor(NodeRunningStatus.Running, isErrorBranch)
      }

      if (linearGradientId) {
        return `url(#${linearGradientId})`
      }

      if (edgeData._connectedNodeIsHovering || isHovering) {
        return getEdgeColor(NodeRunningStatus.Running, isErrorBranch)
      }

      // Default color
      return getEdgeColor(undefined, false)
    }, [
      edgeData._connectedNodeIsHovering,
      isHovering,
      linearGradientId,
      selected,
      isErrorBranch,
      isInput,
    ])

    // Determine stroke width
    const strokeWidth = useMemo(() => {
      if (selected) return EDGE_STROKE_WIDTH_SELECTED
      if (isHovering || edgeData._connectedNodeIsHovering) return EDGE_STROKE_WIDTH_HOVER
      return EDGE_STROKE_WIDTH
    }, [selected, isHovering, edgeData._connectedNodeIsHovering])

    // console.log('CustomEdge render', { _sourceRunningStatus: edgeData._sourceRunningStatus })

    const strokeDasharray = useMemo(() => {
      return edgeData._sourceRunningStatus ? '5' : undefined
    }, [edgeData._sourceRunningStatus])

    const animation = useMemo(() => {
      return selected ? '.5s linear infinite dashdraw' : 'none'
    }, [selected])

    // Callback for when a node is added via AddNodeTrigger
    const handleNodeAdded = useCallback((nodeId: string, nodeType: string) => {
      console.log('Node inserted between edges:', nodeId, nodeType)
      setTriggerOpen(false)
    }, [])

    // Callback for deleting the edge
    const handleDelete = useCallback(() => {
      handleEdgeDelete(id)
    }, [id, handleEdgeDelete])

    // Don't show add/delete buttons on loop structural edges
    const showControls = !isLoopEdge //&& !edgeData?.isInLoop
    // Memoized style objects to prevent re-renders
    const baseEdgeStyle = useMemo(
      () => ({
        stroke,
        strokeWidth,
        opacity: edgeData._waitingRun ? 0.7 : 1,
        strokeDasharray,
        animation,
        // zIndex: edgeData.zIndex || 0,
        // zIndex is now handled by ReactFlow based on edge.zIndex property
        transition:
          'opacity 0.3s cubic-bezier(0.4,0,0.2,1), stroke 0.3s cubic-bezier(0.4,0,0.2,1), stroke-width 0.3s cubic-bezier(0.4,0,0.2,1)',
      }),
      [stroke, strokeWidth, strokeDasharray, animation, edgeData._waitingRun]
    )

    // Get intersection of available blocks - optimized calculation
    const availableBlocks = useMemo(() => {
      if (availablePrevBlocks.length === 0 || availableNextBlocks.length === 0) {
        return []
      }

      const nextSet = new Set(availableNextBlocks)
      return availablePrevBlocks.filter((block) => nextSet.has(block))
    }, [availablePrevBlocks, availableNextBlocks])

    return (
      <>
        {linearGradientId && (
          <CustomEdgeLinearGradient
            id={linearGradientId}
            startColor={getEdgeColor(_sourceRunningStatus)}
            stopColor={getEdgeColor(_targetRunningStatus)}
            position={{ x1: sourceX, y1: sourceY, x2: targetX, y2: targetY }}
          />
        )}

        <g className='cursor-pointer group'>
          <BaseEdge
            id={id}
            path={edgePath}
            style={baseEdgeStyle}
            interactionWidth={60}
            className='hover:shadow-lg hover:shadow-blue-500 '
          />
        </g>

        {!isInput && showControls && (
          <EdgeLabelRenderer>
            {/* Add node button */}
            <div
              className={cn(
                'nopan nodrag transition-all duration-200',
                edgeData._hovering ? 'opacity-100' : 'opacity-0',
                'hover:opacity-100'
              )}
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${addButtonX}px, ${addButtonY}px)`,
                pointerEvents: 'all' as const,
                zIndex: 2000, // zIndex handled by parent edge's zIndex
                // zIndex handled by parent edge's zIndex
              }}>
              <AddNodeTrigger
                position='between'
                anchorNode={
                  sourceNode
                    ? {
                        id: source,
                        type: String(sourceNode.data.type || edgeData.sourceType || ''),
                        position: sourceNode.position,
                        data: sourceNode.data,
                      }
                    : undefined
                }
                sourceHandle={sourceHandleId || 'source'}
                targetNode={{ id: target, targetHandle: targetHandleId || 'target' }}
                customPosition={{ x: addButtonX, y: addButtonY }}
                allowedNodeTypes={availableBlocks}
                open={triggerOpen}
                onOpenChange={setTriggerOpen}
                onNodeAdded={handleNodeAdded}>
                <button
                  className={cn(
                    'z-[2000] flex items-center justify-center',
                    'size-4.5 rounded-full',
                    'bg-blue-500 hover:bg-blue-600',
                    'text-white shadow-lg hover:shadow-xl',
                    'transition-all duration-200',
                    'hover:scale-110',
                    triggerOpen && 'rotate-45 scale-110'
                  )}>
                  <Plus className='size-4' />
                </button>
              </AddNodeTrigger>
            </div>

            {/* Delete button */}
            <div
              className={cn(
                'nopan nodrag transition-all duration-200',
                edgeData._hovering ? 'opacity-100' : 'opacity-0',
                'hover:opacity-100'
              )}
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${deleteButtonX}px, ${deleteButtonY}px)`,
                pointerEvents: 'all' as const,
                zIndex: 2000,
              }}>
              <button
                onClick={handleDelete}
                className={cn(
                  ' flex items-center justify-center',
                  'size-5 rounded-full',
                  'border border-bad-500 bg-white',
                  'hover:bg-bad-500 hover:text-white',
                  'text-bad-500 shadow-lg hover:shadow-xl',
                  'transition-all duration-200',
                  'hover:scale-110'
                )}>
                <Trash2 className='size-3' />
              </button>
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    )
  }
)

CustomEdge.displayName = 'CustomEdge'

export default CustomEdge
