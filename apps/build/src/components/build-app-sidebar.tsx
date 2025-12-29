// apps/build/src/components/build-app-sidebar.tsx
'use client'

import * as React from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from '@auxx/ui/components/sidebar'
import { BuildNavUser } from './build-nav-user'
import { BuildNavMain } from './build-nav-main'
import type { DehydratedBuildUser } from '~/lib/dehydration'

type BuildAppSidebarProps = {
  user: DehydratedBuildUser
  accountSlug: string
} & React.ComponentProps<typeof Sidebar>

/**
 * BuildAppSidebar - sidebar for developer portal
 * Shows user dropdown with accounts list and main nav with apps list
 */
export function BuildAppSidebar({ user, accountSlug, ...props }: BuildAppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <BuildNavUser user={user} accountSlug={accountSlug} />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <BuildNavMain accountSlug={accountSlug} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
