// packages/sdk/src/client/components/badge.tsx

import type React from 'react'

/**
 * Props for the Badge component
 */
export interface BadgeProps {
  /** Badge variant */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
  /** Badge content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
  /** Additional props */
  [key: string]: any
}

/**
 * Badge component for displaying status or labels
 *
 * @example
 * ```tsx
 * import { Badge } from '@auxx/sdk/client'
 *
 * function MyWidget() {
 *   return (
 *     <Badge variant="destructive">
 *       Urgent
 *     </Badge>
 *   )
 * }
 * ```
 */
export const Badge: React.FC<BadgeProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxbadge', {
    ...props,
    component: 'Badge',
  })
}
