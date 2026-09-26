// components/global/sidebar/index.tsx
'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
} from '@auxx/ui/components/sidebar'
import type * as React from 'react'
import { GETTING_STARTED_GOALS } from '~/components/getting-started/client'
import { GettingStartedGroup } from '~/components/getting-started/ui/getting-started-group'
import { MailSidebar } from '~/components/global/sidebar/mail-sidebar'
import { useAccess } from '~/providers/capabilities-provider'
import AppFooter from './app-footer'
import { NavUser } from './nav-user'
import { QuickActionsNav } from './quick-actions-nav'
import { useSidebarItemActions } from './sidebar-item-actions'
import { SidebarTree } from './tree/sidebar-tree'

type Prop = {
  // organizations: { id: string; name: string; logo: React.ReactNode }[]
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean | null
    /** Avatar URL. */
    image: string | null
  }
  // slug: string
} & React.ComponentProps<typeof Sidebar>

/** Main application sidebar; collapse state lives in the cookie-backed `useSidebarState` store. */
export default function AppSidebar({ user, ...props }: Prop) {
  const { editItems, dialogs } = useSidebarItemActions()
  const { can } = useAccess()
  // The Mail group used to render unconditionally while the /app/mail layout guards
  // on inboxes.view, so a member at inboxes None saw a section they could not open.
  // inboxes.view is also synthesised from an individual inbox share, so a member
  // shared one inbox keeps the group.

  return (
    <>
      <Sidebar {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <NavUser user={user} />
            <QuickActionsNav />
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className='gap-0'>
          {can('inboxes.view') && <MailSidebar />}
          <SidebarTree navActions={editItems} />
        </SidebarContent>
        <SidebarFooter>
          <GettingStartedGroup checklistId='main' catalog={GETTING_STARTED_GOALS} />
          <AppFooter />
        </SidebarFooter>
      </Sidebar>
      {dialogs}
    </>
  )
}
