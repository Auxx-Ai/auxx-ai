// File: src/components/mail/mail-thread-item-drag-overlay.tsx
'use client'

import React from 'react'
import { cn } from '@auxx/ui/lib/utils'
import { Skeleton } from '@auxx/ui/components/skeleton'
// Note: Fetching full data here might be slow. Ideally, use minimal data passed
// via activeDragData or fetch a lightweight version. Placeholder uses dummy data.

interface MailThreadItemDragOverlayProps {
  items: string[]
  isDragging: boolean

  // Add other props if needed to fetch/display minimal data
}

/**
 * Renders the visual preview shown while dragging mail thread items.
 * Displays a stacked card effect for multiple items.
 */
const MailThreadItemDragOverlay: React.FC<MailThreadItemDragOverlayProps> = ({ items }) => {
  const count = items.length
  const maxVisible = 5 // Max cards to visually stack
  const displayCount = Math.min(count, maxVisible)
  // const displayCount = 5

  const getRotation = (index: number): number => {
    if (index === 0) return 0 // Top card has no rotation
    // Alternate rotation: e.g., -1deg, 1.5deg, -2deg, 2.5deg
    const magnitude = 1 + (index - 1) * 0.5 // Adjust magnitude as needed
    const direction = index % 2 === 1 ? -1 : 1 // Alternate direction
    return magnitude * direction
  }

  // We also need to adjust the translate slightly based on rotation maybe,
  // or just use a fixed small offset. Let's keep the simple offset for now.
  const getTranslateOffset = (index: number): number => {
    if (index === 0) return 0
    return index * 3 // Small offset in pixels for stacking (adjust as needed)
  }
  // Placeholder: You'd ideally fetch minimal subject/sender for threadIds here
  // For now, we'll just show the count and generic cards.

  return (
    <div className="relative rounded-lg border bg-black opacity-90 shadow-xl">
      {/* Render stacked cards */}
      {displayCount > 1 && (
        <span
          style={{ left: '150px', top: '-5px' }}
          className="absolute z-10 inline-flex size-5 items-center justify-center rounded-full bg-info text-[10px] font-medium leading-none text-white">
          {count}
        </span>
      )}
      <div className="relative">
        {Array.from({ length: displayCount }).map((_, index) => {
          // Reverse index for stacking: last item is on top
          const reversedIndex = displayCount - 1 - index
          const item = items[reversedIndex]
          const id = item?.id ?? item
          const rotation = getRotation(index)
          const translateOffset = getTranslateOffset(index)

          return (
            <div
              key={id}
              className={cn(
                'h-22 pointer-events-none absolute left-0 top-0 w-40 rounded-lg border bg-background p-2' // Base card styles
                // Apply stacking offset, except for the top card
                // index > 0 &&
                //   `transform -translate-x-${index * 1} -translate-y-${index * 1} scale-${1 - index * 0.02}`
              )}
              style={{
                zIndex: displayCount - index, // Stacking order
                transform: `
                translateX(-${translateOffset}px)
                translateY(-${translateOffset}px)
                rotate(${rotation}deg)
                scale(${1 - index * 0.02})
              `,
                // Smooth transition for transform properties
                transition: 'transform 0.1s ease-out',
                // Set transform origin if needed (default is center)
                // transformOrigin: 'top left',
              }}>
              <div className="flex flex-col space-y-1">
                <div className="mb-1 flex flex-row items-center justify-between">
                  <Skeleton className="h-2 w-[70%] rounded-md" />
                  <Skeleton className="h-2 w-[20%] rounded-md" />
                </div>
                <div className="pb-0.5">
                  <Skeleton className="mb-2 h-2 w-[50%] rounded-md" />
                </div>
                <Skeleton className="h-2 w-[80%] rounded-md" />
                <Skeleton className="h-2 w-full rounded-md" />
                <Skeleton className="h-2 w-full rounded-md" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default MailThreadItemDragOverlay
