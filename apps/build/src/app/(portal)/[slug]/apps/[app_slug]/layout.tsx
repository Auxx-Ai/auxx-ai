// apps/build/src/app/(portal)/[slug]/apps/[:app_slug]/layout.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import { tabsTriggerVariants } from '@auxx/ui/components/tabs'
import { cn } from '@auxx/ui/lib/utils'
import { Building, Cable, GitBranch, Info, Lock, Logs, Target } from 'lucide-react'
import Link from 'next/link'
import { redirect, useParams, usePathname } from 'next/navigation'
import { useState } from 'react'
import { AddToOrgDialog } from '~/components/apps/add-to-org-dialog'
import { AppPublishButton } from '~/components/apps/app-publish-button'
import { BuildAppSidebar } from '~/components/build-app-sidebar'
import {
  useApp,
  useAuthenticatedUser,
  useDeveloperAccount,
} from '~/components/providers/dehydrated-state-provider'
/**
 * Layout for individual app pages in developer portal
 * Uses server-fetched dehydrated state from parent layout
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Get params from URL using useParams hook
  const params = useParams<{ slug: string; app_slug: string }>()
  const slug = params.slug
  const appSlug = params['app_slug']
  const pathname = usePathname()

  // Access server-fetched dehydrated state
  const user = useAuthenticatedUser()
  const account = useDeveloperAccount(slug)
  const app = useApp(slug, appSlug)

  const [addToOrgOpen, setAddToOrgOpen] = useState(false)

  // Verify access (data is already fetched server-side)
  if (!account || !app) {
    redirect('/')
  }

  // Define navigation tabs
  const tabs = [
    {
      label: 'General',
      icon: Info,
      href: `/${slug}/apps/${appSlug}`,
    },
    {
      label: 'Versions',
      icon: GitBranch,
      href: `/${slug}/apps/${appSlug}/versions`,
    },
    {
      label: 'Logs',
      icon: Logs,
      href: `/${slug}/apps/${appSlug}/logs`,
    },
    {
      label: 'Connections',
      icon: Cable,
      href: `/${slug}/apps/${appSlug}/connections`,
    },
    {
      label: 'OAuth',
      icon: Lock,
      href: `/${slug}/apps/${appSlug}/oauth`,
    },
    {
      label: 'Scopes',
      icon: Target,
      href: `/${slug}/apps/${appSlug}/scopes`,
    },
  ]

  // Check if current pathname matches tab href
  const isActiveTab = (href: string) => {
    if (href === `/${slug}/apps/${appSlug}`) {
      // For root tab, match exact path
      return pathname === href
    }
    // For sub-routes, check if pathname starts with href
    return pathname.startsWith(href)
  }

  return (
    <div className='h-screen flex flex-1 flex-col w-full h-full'>
      <AddToOrgDialog open={addToOrgOpen} onOpenChange={setAddToOrgOpen} appId={app.id} />
      <SidebarProvider>
        <BuildAppSidebar user={user} accountSlug={slug} />
        <SidebarInset>
          <MainPage>
            <MainPageHeader
              action={
                <div className='flex items-center gap-2'>
                  <Button variant='outline' size='sm' onClick={() => setAddToOrgOpen(true)}>
                    <Building />
                    Add to Organization
                  </Button>
                  <AppPublishButton app={app} size='sm' />
                </div>
              }>
              <MainPageBreadcrumb>
                <MainPageBreadcrumbItem
                  title={app.title}
                  href={`/${slug}/apps/${appSlug}`}
                  last={true}
                />
              </MainPageBreadcrumb>
            </MainPageHeader>

            <MainPageContent>
              <div className='flex-1 h-full flex flex-col'>
                <div className='border-b w-full justify-start rounded-b-none bg-primary-150 inline-flex items-center text-muted-foreground justify-start h-auto gap-1 rounded-none px-2 py-1 border-foreground/10'>
                  {tabs.map((tab) => {
                    const Icon = tab.icon
                    const isActive = isActiveTab(tab.href)
                    return (
                      <Link
                        key={tab.href}
                        href={tab.href}
                        className={cn(
                          tabsTriggerVariants({ variant: 'outline' }),
                          isActive && 'after:bg-foreground text-primary-900 shadow-none'
                        )}
                        data-state={isActive ? 'active' : undefined}>
                        <Icon />
                        {tab.label}
                      </Link>
                    )
                  })}
                </div>
                {children}
              </div>
            </MainPageContent>
          </MainPage>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
