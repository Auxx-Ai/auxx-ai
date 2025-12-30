// apps/web/src/components/mail/mail-thread-item-drag-overlay.tsx
'use client'

import React from 'react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useStackedDragOverlay } from '~/hooks/use-stacked-drag-overlay'

/**
 * Props for MailThreadItemDragOverlay component
 */
interface MailThreadItemDragOverlayProps {
  items: string[]
  isDragging: boolean
}

/**
 * Renders the visual preview shown while dragging mail thread items.
 * Displays a stacked card effect for multiple items.
 */
const MailThreadItemDragOverlay: React.FC<MailThreadItemDragOverlayProps> = ({ items }) => {
  const { getItemStyle, indices, showBadge, totalCount } = useStackedDragOverlay({
    count: items.length,
  })

  return (
    <div className="relative rounded-lg border bg-black opacity-90 shadow-xl">
      {showBadge && (
        <span
          style={{ left: '150px', top: '-5px' }}
          className="absolute z-10 inline-flex size-5 items-center justify-center rounded-full bg-info text-[10px] font-medium leading-none text-white">
          {totalCount}
        </span>
      )}
      <div className="relative">
        {indices.map((itemIndex, renderIndex) => {
          const item = items[itemIndex]
          const id = (item as any)?.id ?? item ?? renderIndex

          return (
            <div
              key={id}
              className="h-22 pointer-events-none w-40 rounded-lg border bg-background p-2"
              style={getItemStyle(renderIndex)}>
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
