// packages/sdk/src/client/components/banner.tsx

import type React from 'react'

/**
 * Props for the Banner component
 */
export interface BannerProps {
  /** Banner variant */
  variant?: 'info' | 'warning' | 'error' | 'success'
  /** Banner content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
  /** Additional props */
  [key: string]: any
}

/**
 * Banner component for displaying important messages
 *
 * @example
 * ```tsx
 * import { Banner } from '@auxx/sdk/client'
 *
 * function MyWidget() {
 *   return (
 *     <Banner variant="warning">
 *       This is a warning message
 *     </Banner>
 *   )
 * }
 * ```
 */
export const Banner: React.FC<BannerProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxbanner', {
    ...props,
    component: 'Banner',
  })
}
