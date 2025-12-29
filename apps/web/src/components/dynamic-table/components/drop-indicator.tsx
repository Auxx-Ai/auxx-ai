// apps/web/src/components/dynamic-table/components/drop-indicator.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'

interface DropIndicatorProps {
  position: 'above' | 'below' | 'inside'
  isActive?: boolean
}

/**
 * Visual indicator for drag and drop operations
 */
export function DropIndicator({ position, isActive = true }: DropIndicatorProps) {
  const className = cn(
    'absolute w-full z-50 transition-all duration-200 pointer-events-none',
    {
      'h-0.5 bg-blue-500 -top-px left-0 right-0': position === 'above',
      'h-0.5 bg-blue-500 -bottom-px left-0 right-0': position === 'below',
      'inset-0 bg-blue-100 border-2 border-blue-500 border-dashed rounded': position === 'inside',
    },
    !isActive && 'opacity-0'
  )

  return <div className={className} />
}
