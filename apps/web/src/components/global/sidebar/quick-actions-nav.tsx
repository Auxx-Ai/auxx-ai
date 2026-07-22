// apps/web/src/components/global/sidebar/quick-actions-nav.tsx
'use client'

import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { SidebarMenuButton, SidebarMenuItem } from '@auxx/ui/components/sidebar'
import { Zap } from 'lucide-react'
import { useCommandPaletteStore } from '~/components/kbar/store'

/**
 * Sidebar-header entry that opens the command palette. Sits directly below
 * {@link NavUser} inside the shared `SidebarMenu`. The `⌘K` hint is hidden when
 * the sidebar collapses to icon-only mode.
 */
export function QuickActionsNav() {
  const openPalette = useCommandPaletteStore((s) => s.openPalette)

  return (
    <SidebarMenuItem className='mt-2'>
      <SidebarMenuButton
        onClick={openPalette}
        tooltip='Quick Actions'
        className='h-7 shadow-[inset_0_0_0_1px_rgba(255,255,255,0),0_0_2px_0_rgba(28,40,64,0.18),0_1px_3px_0_rgba(24,41,75,0.04)] transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent dark:shadow-[inset_0_0_0_1px_#2f3033,0_0_2px_0_#000,0_1px_3px_0_rgba(0,0,0,0.08)]'>
        <Zap />
        <span>Quick Actions</span>
        <KbdGroup size='sm' className='ml-auto' variant='outline'>
          <Kbd shortcut='meta' />
          <Kbd>K</Kbd>
        </KbdGroup>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
