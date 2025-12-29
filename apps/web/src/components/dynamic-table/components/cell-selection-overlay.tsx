// apps/web/src/components/dynamic-table/components/cell-selection-overlay.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'

interface CellSelectionOverlayProps {
  isSelected: boolean
  isEditing: boolean
  className?: string
}

/**
 * Absolute positioned overlay for cell selection highlighting
 * Uses inset-0 with pointer-events-none for non-blocking visuals
 */
export function CellSelectionOverlay({ isSelected, isEditing, className }: CellSelectionOverlayProps) {
  if (!isSelected && !isEditing) return null

  return (
    <div
      className={cn(
        'absolute inset-0 pointer-events-none rounded-md z-11',
        isSelected && !isEditing && 'ring-1 ring-blue-500 ring-inset bg-blue-500/5',
        isEditing && 'ring-1 ring-blue-600 ring-inset bg-blue-500/10',
        className
      )}
    />
  )
}
