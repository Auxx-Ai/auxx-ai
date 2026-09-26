// apps/web/src/components/favorites/ui/private-item.tsx
'use client'

import { Lock } from 'lucide-react'
import { SidebarNavItem } from '~/components/global/sidebar/sidebar-nav-item'

/**
 * Rendered when a favorite's target can't be resolved — it was deleted, is no
 * longer accessible (404 / 403), or never finished loading. The sidebar tree's
 * row menu keeps it removable.
 */
export function PrivateItem({ favoriteId }: { favoriteId: string }) {
  return (
    <SidebarNavItem
      id={favoriteId}
      name='Unavailable'
      href='#'
      icon={<Lock />}
      isSubmenu
      className='text-muted-foreground italic'
    />
  )
}
