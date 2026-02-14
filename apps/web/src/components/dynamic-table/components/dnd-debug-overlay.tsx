// apps/web/src/components/dynamic-table/components/dnd-debug-overlay.tsx

'use client'

import { useDndContext } from '@dnd-kit/core'
import { useEffect, useState } from 'react'

interface DebugRect {
  id: string
  rect: DOMRect
  type: 'draggable' | 'droppable'
  isActive?: boolean
}

interface DndDebugOverlayProps {
  /** Enable debug visualization */
  enabled?: boolean
  /** Show collision rectangles */
  showRects?: boolean
  /** Show collision points/centers */
  showCenters?: boolean
  /** Show distances between elements */
  showDistances?: boolean
}

/**
 * Debug overlay to visualize dnd-kit collision detection rectangles
 */
export function DndDebugOverlay({
  enabled = false,
  showRects = true,
  showCenters = false,
  showDistances = false,
}: DndDebugOverlayProps) {
  const { active, over, droppableContainers, draggableNodes } = useDndContext()
  const [debugRects, setDebugRects] = useState<DebugRect[]>([])

  useEffect(() => {
    if (!enabled) {
      setDebugRects([])
      return
    }

    const rects: DebugRect[] = []

    // Get draggable rectangles
    draggableNodes.forEach((node, id) => {
      if (node.current) {
        const rect = node.current.getBoundingClientRect()
        rects.push({
          id: String(id),
          rect,
          type: 'draggable',
          isActive: active?.id === id,
        })
      }
    })

    // Get droppable rectangles
    droppableContainers.forEach((container, id) => {
      if (container.node.current) {
        const rect = container.node.current.getBoundingClientRect()
        rects.push({
          id: String(id),
          rect,
          type: 'droppable',
          isActive: over?.id === id,
        })
      }
    })

    setDebugRects(rects)
  }, [enabled, active, over, droppableContainers, draggableNodes])

  if (!enabled) return null

  return (
    <div className='fixed inset-0 pointer-events-none z-[9999]'>
      {/* Debug rectangles */}
      {showRects &&
        debugRects.map((debugRect) => (
          <div
            key={`${debugRect.type}-${debugRect.id}`}
            className={`absolute border-2 ${
              debugRect.type === 'draggable'
                ? debugRect.isActive
                  ? 'border-red-500 bg-red-500/10'
                  : 'border-blue-500 bg-blue-500/5'
                : debugRect.isActive
                  ? 'border-green-500 bg-green-500/10'
                  : 'border-yellow-500 bg-yellow-500/5'
            }`}
            style={{
              left: debugRect.rect.left,
              top: debugRect.rect.top,
              width: debugRect.rect.width,
              height: debugRect.rect.height,
            }}>
            {/* Label */}
            <div
              className={`absolute -top-6 left-0 px-1 text-xs font-mono opacity-10 ${
                debugRect.type === 'draggable'
                  ? debugRect.isActive
                    ? 'bg-red-500 text-white'
                    : 'bg-blue-500 text-white'
                  : debugRect.isActive
                    ? 'bg-green-500 text-white'
                    : 'bg-yellow-500 text-black'
              }`}>
              {debugRect.type}: {debugRect.id}
            </div>
          </div>
        ))}

      {/* Debug centers */}
      {showCenters &&
        debugRects.map((debugRect) => {
          const centerX = debugRect.rect.left + debugRect.rect.width / 2
          const centerY = debugRect.rect.top + debugRect.rect.height / 2

          return (
            <div
              key={`center-${debugRect.type}-${debugRect.id}`}
              className={`absolute w-2 h-2 rounded-full ${
                debugRect.type === 'draggable'
                  ? debugRect.isActive
                    ? 'bg-red-500'
                    : 'bg-blue-500'
                  : debugRect.isActive
                    ? 'bg-green-500'
                    : 'bg-yellow-500'
              }`}
              style={{
                left: centerX - 4,
                top: centerY - 4,
              }}
            />
          )
        })}

      {/* Debug distances */}
      {showDistances && active && over && (
        <div className='absolute top-4 left-4 bg-black/80 text-white p-2 rounded text-sm font-mono'>
          <div>Active: {active.id}</div>
          <div>Over: {over.id}</div>
          {active.rect.current && over.rect && (
            <div>
              Distance:{' '}
              {Math.round(
                Math.sqrt(
                  (active.rect.current.left +
                    active.rect.current.width / 2 -
                    (over.rect.left + over.rect.width / 2)) **
                    2 +
                    (active.rect.current.top +
                      active.rect.current.height / 2 -
                      (over.rect.top + over.rect.height / 2)) **
                      2
                )
              )}
              px
            </div>
          )}
        </div>
      )}
    </div>
  )
}
