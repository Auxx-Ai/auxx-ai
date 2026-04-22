// apps/web/src/components/dynamic-table/components/fill-handle.tsx
'use client'

import { useFillDragContext } from '../context/fill-drag-context'

/**
 * The little blue square at the bottom-right corner of the active selection,
 * à la Excel. Pointer-down starts a fill-drag; release commits a tile-copy
 * of the source values into the extended range.
 *
 * Visual: 8×8 blue square with white ring for contrast. The surrounding
 * 14×14 wrapper is the pointer hit target (larger than the visible square
 * so it's trackpad-friendly).
 */
export function FillHandle() {
  const fill = useFillDragContext()

  return (
    <div
      data-slot='fill-handle'
      className='absolute -right-[5px] -bottom-[5px] h-[14px] w-[14px] flex items-center justify-center cursor-crosshair pointer-events-auto z-30'
      onPointerDown={(e) => {
        // Stop propagation so the underlying cell's pointerdown doesn't
        // trigger range-drag or clear the selection.
        e.stopPropagation()
        if (e.button !== 0) return
        if (e.pointerType === 'touch') return
        fill?.beginFillDrag(e.pointerId, e.clientX, e.clientY)
      }}>
      <div className='size-1 rounded-[1px] bg-info ring-1 ring-white dark:ring-black/30' />
    </div>
  )
}
