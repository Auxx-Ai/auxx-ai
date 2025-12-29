// components/global/sidebar/index.tsx
'use client'

import * as React from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@auxx/ui/components/sidebar'
import { NavMain } from './nav-main'
import { SIDEBAR_MENU } from '~/constants/menu'
import { NavUser } from './nav-user'
import { MailSidebar } from '~/components/global/sidebar/mail-sidebar'
import { EntitySidebarNav } from './entity-sidebar-nav'
import AppFooter from './app-footer'
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
  return (
    <SidebarStateProvider>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <NavUser user={user} />
        </SidebarHeader>
        <SidebarContent className="gap-0">
          <MailSidebar />
          <NavMain menu={navMain} />
          <EntitySidebarNav />
        </SidebarContent>
        <SidebarFooter>
          <AppFooter />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </SidebarStateProvider>
  )
}
