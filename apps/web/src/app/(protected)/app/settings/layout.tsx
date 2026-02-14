'use client'
import { WEBAPP_URL } from '@auxx/config/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { usePathname } from 'next/navigation'
import type * as React from 'react'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import { SETTINGS_MENU } from '~/constants/menu'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
// type Props = { children: React.ReactNode; slug: string }

export default function SettingsSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[3]

  const baseUrl = `${WEBAPP_URL}/app/settings`
  const { features, isLoading, error, hasAccess, getLimit } = useFeatureFlags()

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Settings' href='/app/settings/general' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className='rounded-2xl border border-neutral-200/80 dark:border-primary-200/80 flex flex-col md:flex-row h-full w-full overflow-hidden shadow-lg max-w-6xl'>
          <SidebarSecondary
            items={SETTINGS_MENU}
            baseUrl={baseUrl}
            current={page}
            title='Settings'
          />
          <div className='relative flex h-full flex-1 grow overflow-hidden bg-background '>
            {children}
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
