// apps/build/src/app/(portal)/[slug]/apps/[:app_slug]/layout.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import { redirect, useParams } from 'next/navigation'
import { BuildAppSidebar } from '~/components/build-app-sidebar'
import {
  useAuthenticatedUser,
  useDeveloperAccount,
} from '~/components/providers/dehydrated-state-provider'
/**
 * Layout for individual app pages in developer portal
 * Uses server-fetched dehydrated state from parent layout
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Get params from URL using useParams hook
  const params = useParams<{ slug: string }>()
  const slug = params.slug

  // Access server-fetched dehydrated state
  const user = useAuthenticatedUser()
  const account = useDeveloperAccount(slug)

  // Verify access (data is already fetched server-side)
  if (!account) {
    redirect('/')
  }

  return (
    <div className='h-screen flex flex-1 flex-col w-full h-full'>
      <SidebarProvider>
        <BuildAppSidebar user={user} accountSlug={slug} />
        <SidebarInset>
          <MainPage>
            <MainPageHeader>
              <MainPageBreadcrumb>
                <MainPageBreadcrumbItem
                  title={`Settings`}
                  href={`/${slug}/settings/general`}
                  last={true}
                />
              </MainPageBreadcrumb>
            </MainPageHeader>

            <MainPageContent>
              <div className='flex-1 h-full flex flex-col'>{children}</div>
            </MainPageContent>
          </MainPage>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
