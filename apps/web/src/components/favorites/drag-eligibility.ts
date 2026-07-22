// apps/web/src/components/favorites/drag-eligibility.ts
import type { Active } from '@dnd-kit/core'

/**
 * dnd-kit drag `data.current.type` values the app-shell sidebar (favorites) accepts as drops.
 * Single source of truth shared by the drag-end router (`dashboard.tsx`) and the drag-to-peek
 * spring-loader (`SidebarDragPeek`) so a new droppable type can't silently miss the spring-load.
 */
export const SIDEBAR_FAVORITE_DRAG_TYPES = ['favorite'] as const

/** Whether an active drag targets the sidebar favorites. */
export function isSidebarFavoriteDrag(active: Active | null | undefined): boolean {
  const type = active?.data?.current?.type
  return (
    typeof type === 'string' && (SIDEBAR_FAVORITE_DRAG_TYPES as readonly string[]).includes(type)
  )
}
