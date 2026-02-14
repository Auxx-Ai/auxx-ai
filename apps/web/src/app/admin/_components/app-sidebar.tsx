// apps/web/src/app/admin/_components/app-sidebar.tsx
'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@auxx/ui/components/sidebar'
import type * as React from 'react'
import { NavUser } from '~/components/global/sidebar/nav-user'
import { AdminNavMain } from './admin-nav-main'

/**
 * User prop interface
 */
interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean | null
  image: boolean | null
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
export function AdminAppSidebar({ user, ...props }: AdminAppSidebarProps) {
  return (
    <Sidebar collapsible='icon' {...props}>
      <SidebarHeader>
        <NavUser user={user} />
      </SidebarHeader>
      <SidebarContent className='gap-0'>
        <AdminNavMain />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
