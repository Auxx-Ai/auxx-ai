// packages/sdk/src/client/components/separator.tsx

import type React from 'react'

/**
 * Props for the Separator component
 */
export interface SeparatorProps {
  /** Orientation of the separator */
  orientation?: 'horizontal' | 'vertical'
  /** Additional CSS classes */
  className?: string
  /** Additional props */
  [key: string]: any
}

/**
 * Separator component for visual separation
 *
 * @example
 * ```tsx
 * import { Separator } from '@auxx/sdk/client'
 *
 * function MyDialog() {
 *   return (
 *     <>
 *       <TextBlock>Content above</TextBlock>
 *       <Separator />
 *       <TextBlock>Content below</TextBlock>
 *     </>
 *   )
 * }
 * ```
 */
export const Separator: React.FC<SeparatorProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxseparator', {
    ...props,
    component: 'Separator',
  })
}
