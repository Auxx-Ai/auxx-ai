// apps/web/src/hooks/use-effective-dock-state.ts
'use client'

import { useMedia } from '~/hooks/use-media'
import { useDockStore } from '~/stores/dock-store'

/**
 * Returns effective dock state, accounting for screen size.
 * On mobile (< 1024px), always returns false (overlay mode).
 */
export function useEffectiveDockState() {
  const isDocked = useDockStore((state) => state.isDocked)
  const isDesktop = useMedia('(min-width: 1024px)')

  return isDocked && isDesktop
}
