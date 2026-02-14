// apps/web/src/lib/extensions/components/workflow/layout/input-group.tsx

'use client'

import type React from 'react'

/** Gap size options for InputGroup */
type GapSize = 'sm' | 'md' | 'lg'

/** Props for InputGroup component */
interface InputGroupProps {
  /** Child elements to render inside the group */
  children: React.ReactNode
  /** Gap size between items */
  gap?: GapSize
  /** Additional CSS classes */
  className?: string
}

/**
 * InputGroup component.
 * Layout container for arranging inputs horizontally.
 */
export const InputGroup = ({ children, gap = 'md', className = '' }: InputGroupProps) => {
  const gapClasses: Record<GapSize, string> = {
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4',
  }

  const gapClass = gapClasses[gap]

  return <div className={`flex items-start ${gapClass} ${className}`}>{children}</div>
}
