// apps/build/src/components/build-nav-main.tsx
'use client'

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { Building2, NotebookText, Package, Plus, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CreateAppDialog } from './apps/create-app-dialog'
import { useAccountApps, useDeveloperAccount } from './providers/dehydrated-state-provider'
import { SidebarItem } from './sidebar/sidebar-item'

interface Props {
  accountSlug: string
}

/**
 * BuildNavMain - main sidebar navigation
 * Shows list of apps for the active developer account
 */
export function BuildNavMain({ accountSlug }: Props) {
  const pathname = usePathname()
  const account = useDeveloperAccount(accountSlug)
  const apps = useAccountApps(account?.id || '')

  function isActive(appSlug: string): boolean {
    return pathname.startsWith(`/${accountSlug}/apps/${appSlug}`)
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Apps</SidebarGroupLabel>
        <SidebarMenu className=''>
          {apps.length === 0 ? (
            <SidebarMenuItem>
              <div className='px-2 py-1.5 text-xs text-muted-foreground'>No apps yet</div>
            </SidebarMenuItem>
          ) : (
            apps.map((app) => (
              <SidebarMenuItem key={app.id}>
                <SidebarItem
                  id={app.id}
                  name={app.title}
                  href={`/${accountSlug}/apps/${app.slug}`}
                  icon={
                    app.avatarUrl ? (
                      <img
                        src={app.avatarUrl}
                        alt={app.title}
                        className='size-4 rounded-sm object-cover'
                      />
                    ) : (
                      <Package />
                    )
                  }
                  isActive={isActive(app.slug)}
                />
              </SidebarMenuItem>
            ))
          )}
          {apps.length > 0 && (
            <SidebarMenuItem>
              <CreateAppDialog
                accountSlug={accountSlug}
                trigger={
                  <SidebarMenuButton className='text-muted-foreground'>
                    <Plus />
                    <span>New app</span>
                  </SidebarMenuButton>
                }
              />
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Organization Settings</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className='text-muted-foreground' asChild>
              <Link href={`/${accountSlug}/settings/general`}>
                <Building2 /> General
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton className='text-muted-foreground' asChild>
              <Link href={`/${accountSlug}/settings/members`}>
                <Users /> Members
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Resources</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className='text-muted-foreground'>
              <NotebookText /> Documentation
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </>
  )
}
