// apps/web/src/app/admin/_components/app-sidebar.tsx
'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
} from '@auxx/ui/components/sidebar'
import type * as React from 'react'
import { NavUser } from '~/components/global/sidebar/nav-user'
import { useEnv } from '~/providers/dehydrated-state-provider'
import { AdminNavMain } from './admin-nav-main'

/**
 * User prop interface
 */
interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean | null
  image: string | null
}

/**
 * AdminAppSidebar props
 */
type AdminAppSidebarProps = {
  user: User
} & React.ComponentProps<typeof Sidebar>

/**
 * AdminAppSidebar component - sidebar for admin area
 */
function AdminVersionFooter() {
  const { version } = useEnv()
  return (
    <div className='px-3 py-2 text-[11px] text-muted-foreground/60 truncate'>
      {version.appVersion} ({version.commit})
    </div>
  )
}

export function AdminAppSidebar({ user, ...props }: AdminAppSidebarProps) {
  return (
    <Sidebar className='p-0' {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <NavUser user={user} />
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className='gap-0'>
        <AdminNavMain />
      </SidebarContent>
      <SidebarFooter>
        <AdminVersionFooter />
      </SidebarFooter>
    </Sidebar>
  )
}
