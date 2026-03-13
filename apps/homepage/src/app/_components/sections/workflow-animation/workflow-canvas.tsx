// apps/homepage/src/app/_components/sections/workflow-animation/workflow-canvas.tsx

'use client'

import { useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useWorkflowAnimation } from './use-workflow-animation'
import { WorkflowConnector } from './workflow-connector'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  edges,
  MOBILE_CANVAS_HEIGHT,
  MOBILE_CANVAS_WIDTH,
  mobileEdges,
  mobileNodes,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodes,
} from './workflow-data'
import { WorkflowNode } from './workflow-node'

const FULL_WIDTH = CANVAS_WIDTH + NODE_WIDTH
const FULL_HEIGHT = CANVAS_HEIGHT + NODE_HEIGHT

export function WorkflowCanvas() {
  const ref = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const { activeNodes } = useWorkflowAnimation(inView)
  const [scale, setScale] = useState(1)

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const mobileNodeMap = Object.fromEntries(mobileNodes.map((n) => [n.id, n]))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        const containerWidth = entry.contentRect.width
        setScale(Math.min(1, containerWidth / FULL_WIDTH))
      }
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className='mx-auto w-full'>
      {/* Desktop layout */}
      <div ref={containerRef} className='hidden md:block'>
        <div
          className='relative mx-auto overflow-hidden'
          style={{
            height: FULL_HEIGHT * scale,
          }}>
          <div
            className='origin-top-left'
            style={{
              width: FULL_WIDTH,
              height: FULL_HEIGHT,
              transform: `scale(${scale})`,
              position: 'relative',
            }}>
            {/* SVG connectors layer */}
            <svg
              className='pointer-events-none absolute inset-0'
              width={FULL_WIDTH}
              height={FULL_HEIGHT}
              style={{ overflow: 'visible' }}>
              <defs>
                <marker
                  id='arrowhead'
                  markerWidth='8'
                  markerHeight='6'
                  refX='7'
                  refY='3'
                  orient='auto'>
                  <polygon points='0 0, 8 3, 0 6' fill='#94a3b8' />
                </marker>
              </defs>
              {edges.map((edge) => (
                <WorkflowConnector
                  key={edge.id}
                  edge={edge}
                  sourceNode={nodeMap[edge.source]}
                  targetNode={nodeMap[edge.target]}
                  inView={inView}
                />
              ))}
            </svg>

            {/* Nodes layer */}
            {nodes.map((node) => (
              <WorkflowNode
                key={node.id}
                node={node}
                inView={inView}
                isActive={activeNodes.has(node.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile layout */}
      <div className='flex justify-center md:hidden'>
        <div
          className='relative'
          style={{
            width: MOBILE_CANVAS_WIDTH,
            height: MOBILE_CANVAS_HEIGHT,
          }}>
          {/* SVG connectors layer */}
          <svg
            className='pointer-events-none absolute inset-0'
            width={MOBILE_CANVAS_WIDTH}
            height={MOBILE_CANVAS_HEIGHT}
            style={{ overflow: 'visible' }}>
            <defs>
              <marker
                id='arrowhead-mobile'
                markerWidth='8'
                markerHeight='6'
                refX='7'
                refY='3'
                orient='auto'>
                <polygon points='0 0, 8 3, 0 6' fill='#94a3b8' />
              </marker>
            </defs>
            {mobileEdges.map((edge) => (
              <WorkflowConnector
                key={edge.id}
                edge={edge}
                sourceNode={mobileNodeMap[edge.source]}
                targetNode={mobileNodeMap[edge.target]}
                inView={inView}
                vertical
              />
            ))}
          </svg>

          {/* Nodes layer */}
          {mobileNodes.map((node) => (
            <WorkflowNode
              key={node.id}
              node={node}
              inView={inView}
              isActive={activeNodes.has(node.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
