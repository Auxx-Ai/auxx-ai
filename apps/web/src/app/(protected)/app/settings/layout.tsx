'use client'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import { SETTINGS_MENU } from '~/constants/menu'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { WEBAPP_URL } from '@auxx/config/client'
// type Props = { children: React.ReactNode; slug: string }

export default function SettingsSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[3]

  const baseUrl = `${WEBAPP_URL}/app/settings`
  const { features, isLoading, error, hasAccess, getLimit } = useFeatureFlags()

  return (
    <div className="flex h-screen flex-1 overflow-hidden p-3 bg-neutral-100 dark:bg-background">
      <div className="rounded-2xl border border-neutral-200/80 dark:border-primary-200/80 flex flex-col md:flex-row h-full w-full overflow-hidden shadow-lg max-w-6xl">
        <SidebarSecondary items={SETTINGS_MENU} baseUrl={baseUrl} current={page} title="Settings" />
        <div className="relative flex h-full flex-1 grow overflow-hidden bg-background">
          {children}
        </div>
      </div>
    </div>
  )
}
