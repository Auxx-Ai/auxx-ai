// apps/homepage/src/app/_components/sections/workflow-animation/workflow-connector.tsx

'use client'

import { motion } from 'motion/react'
import type { WorkflowEdge, WorkflowNode } from './workflow-data'
import { NODE_HEIGHT, NODE_WIDTH } from './workflow-data'

interface WorkflowConnectorProps {
  edge: WorkflowEdge
  sourceNode: WorkflowNode
  targetNode: WorkflowNode
  inView: boolean
  vertical?: boolean
}

function computeHorizontalPath(source: WorkflowNode, target: WorkflowNode): string {
  const sx = source.x + NODE_WIDTH
  const sy = source.y + NODE_HEIGHT / 2
  const tx = target.x
  const ty = target.y + NODE_HEIGHT / 2
  const midX = (sx + tx) / 2

  return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`
}

function computeVerticalPath(source: WorkflowNode, target: WorkflowNode): string {
  const sx = source.x + NODE_WIDTH / 2
  const sy = source.y + NODE_HEIGHT
  const tx = target.x + NODE_WIDTH / 2
  const ty = target.y
  const midY = (sy + ty) / 2

  return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`
}

export function WorkflowConnector({
  edge,
  sourceNode,
  targetNode,
  inView,
  vertical = false,
}: WorkflowConnectorProps) {
  const pathData = vertical
    ? computeVerticalPath(sourceNode, targetNode)
    : computeHorizontalPath(sourceNode, targetNode)

  return (
    <g>
      {/* Background path (static) */}
      <motion.path
        d={pathData}
        fill='none'
        stroke='#94a3b8'
        strokeWidth={2}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={inView ? { pathLength: 1, opacity: 0.4 } : undefined}
        transition={{
          pathLength: { duration: 0.5, ease: 'easeInOut', delay: edge.delay },
          opacity: { duration: 0.2, delay: edge.delay },
        }}
      />

      {/* Animated foreground path */}
      <motion.path
        d={pathData}
        fill='none'
        stroke={edge.isHappyPath ? '#10b981' : '#94a3b8'}
        strokeWidth={2}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={inView ? { pathLength: 1, opacity: 1 } : undefined}
        transition={{
          pathLength: { duration: 0.5, ease: 'easeInOut', delay: edge.delay },
          opacity: { duration: 0.2, delay: edge.delay },
        }}
        markerEnd='url(#arrowhead)'
      />

      {/* Edge label */}
      {edge.label && (
        <motion.text
          x={
            vertical
              ? (sourceNode.x + NODE_WIDTH / 2 + targetNode.x + NODE_WIDTH / 2) / 2 + 14
              : (sourceNode.x + NODE_WIDTH + targetNode.x) / 2
          }
          y={
            vertical
              ? (sourceNode.y + NODE_HEIGHT + targetNode.y) / 2
              : (sourceNode.y + NODE_HEIGHT / 2 + targetNode.y + NODE_HEIGHT / 2) / 2 - 8
          }
          textAnchor='middle'
          className='fill-muted-foreground text-[11px] font-medium'
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ delay: edge.delay + 0.3, duration: 0.3 }}>
          {edge.label}
        </motion.text>
      )}

      {/* Traveling dot along happy path */}
      {edge.isHappyPath && (
        <motion.circle
          r={4}
          fill='#10b981'
          initial={{ offsetDistance: '0%', opacity: 0 }}
          animate={inView ? { offsetDistance: '100%', opacity: [0, 1, 1, 0] } : undefined}
          transition={{
            duration: 0.6,
            delay: 2.3 + (edge.delay - 0.2) * 0.5,
            ease: 'easeInOut',
          }}
          style={{ offsetPath: `path('${pathData}')` }}
        />
      )}
    </g>
  )
}
