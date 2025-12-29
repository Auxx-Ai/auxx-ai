// apps/web/src/components/workflow/ui/node-handle/handle-position-utils.ts

import { Position } from '@xyflow/react'

/** Handle position on the node */
export type HandlePosition = 'left' | 'right' | 'top' | 'bottom'

/**
 * Map position string to React Flow Position enum.
 */
export function mapPosition(position: HandlePosition): Position {
  switch (position) {
    case 'left':
      return Position.Left
    case 'right':
      return Position.Right
    case 'top':
      return Position.Top
    case 'bottom':
      return Position.Bottom
  }
}

/**
 * Get position classes for handle container.
 */
export function getPositionClass(position: HandlePosition): string {
  switch (position) {
    case 'left':
      return 'left-0 top-1/2 -translate-y-1/2'
    case 'right':
      return 'right-0 top-1/2 -translate-y-1/2'
    case 'top':
      return 'top-0 left-1/2 -translate-x-1/2'
    case 'bottom':
      return 'bottom-0 left-1/2 -translate-x-1/2'
  }
}

/**
 * Get indicator classes based on position.
 */
export function getIndicatorClass(position: HandlePosition): string {
  switch (position) {
    case 'left':
      return 'after:left-1.5 after:top-1 after:h-2 after:w-0.5'
    case 'right':
      return 'after:right-1.5 after:top-1 after:h-2 after:w-0.5'
    case 'top':
      return 'after:left-1 after:top-1.5 after:w-2 after:h-0.5'
    case 'bottom':
      return 'after:left-1 after:bottom-1.5 after:w-2 after:h-0.5'
  }
}
