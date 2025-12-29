'use client'
// apps/web/src/components/apps/installed-app-tabs.tsx
import React from 'react'
import { useSelectedLayoutSegment } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Props for InstalledAppTabs component
 */
type Props = {
  slug: string
  children: React.ReactNode
}

/**
 * InstalledAppTabs component
 * Client component that handles tab navigation and active state detection
 */
export function InstalledAppTabs({ slug, children }: Props) {
  const segment = useSelectedLayoutSegment()

  const tabs = [
    { label: 'About', value: 'about', href: `/app/settings/apps/installed/${slug}/about` },
    {
      label: 'Connections',
      value: 'connections',
      href: `/app/settings/apps/installed/${slug}/connections`,
    },
    {
      label: 'Settings',
      value: 'settings',
      href: `/app/settings/apps/installed/${slug}/settings`,
    },
  ]

  const activeTab = segment || 'about'

  return (
    <div className="flex flex-col flex-1">
      {/* Tab Navigation */}
      <div className="border-b px-6 py-1 sticky top-0">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <Link key={tab.value} href={tab.href}>
              <button
                className={cn(
                  'h-7 inline-flex items-center shrink-0 justify-center whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium  transition-all focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
                  'hover:text-foreground',
                  'text-primary-500 hover:bg-primary-200/70 hover:text-primary-900 data-[state=active]:text-primary-900 relative  data-[state=active]:shadow-none [&>svg]:size-3.5 [&>svg]:mr-1.5 [&>svg]:opacity-70',
                  activeTab === tab.value
                    ? 'ring-1 ring-primary-200 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {tab.label}
              </button>
            </Link>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {children}
    </div>
  )
}
