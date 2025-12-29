// packages/sdk/src/client/components/avatar.tsx

import type React from 'react'

/**
 * Props for the Avatar component
 */
export interface AvatarProps {
  /** Avatar source URL */
  src?: string
  /** Alt text for the avatar */
  alt?: string
  /** Avatar size */
  size?: 'small' | 'medium' | 'large'
  /** Fallback initials */
  fallback?: string
  /** Additional CSS classes */
  className?: string
  /** Additional props */
  [key: string]: any
}

/**
 * Avatar component for displaying user avatars
 *
 * @example
 * ```tsx
 * import { Avatar } from '@auxx/sdk/client'
 *
 * function MyWidget() {
 *   return (
 *     <Avatar src="https://example.com/avatar.jpg" alt="User" />
 *   )
 * }
 * ```
 */
export const Avatar: React.FC<AvatarProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxavatar', {
    ...props,
    component: 'Avatar',
  })
}
