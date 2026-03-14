// components/global/sidebar/index.tsx
'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@auxx/ui/components/sidebar'
import type * as React from 'react'
import { MailSidebar } from '~/components/global/sidebar/mail-sidebar'
import { SIDEBAR_MENU } from '~/constants/menu'
import AppFooter from './app-footer'
import { EntitySidebarNav } from './entity-sidebar-nav'
import { NavMain } from './nav-main'
import { NavUser } from './nav-user'
import { useSidebarItemActions } from './sidebar-item-actions'
import { SidebarStateProvider } from './sidebar-state-context'

const navMain = { title: 'Main', items: SIDEBAR_MENU, route: '/app' }
type Prop = {
  // organizations: { id: string; name: string; logo: React.ReactNode }[]
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean | null
    image: boolean | null
  }
  // slug: string
} & React.ComponentProps<typeof Sidebar>

/** Main application sidebar component with localStorage-persisted open/closed states */
export default function AppSidebar({ user, ...props }: Prop) {
  const { editItems, dialogs } = useSidebarItemActions()

  return (
    <SidebarStateProvider>
      <Sidebar collapsible='icon' {...props}>
        <SidebarHeader>
          <NavUser user={user} />
        </SidebarHeader>
        <SidebarContent className='gap-0'>
          <MailSidebar />
          <NavMain menu={navMain} itemActions={editItems} />
          <EntitySidebarNav />
        </SidebarContent>
        <SidebarFooter>
          <AppFooter />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      {dialogs}
    </SidebarStateProvider>
  )
}
