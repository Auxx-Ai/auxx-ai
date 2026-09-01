// apps/web/src/app/(protected)/app/parts/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { SlidersHorizontal } from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Parts settings navigation (25-parts-settings-tab.md §3) — ONE page.
 *
 * Auto-build is the only org setting the parts domain owns today: receiving has
 * none, and the `manufacturing.*` absorption rates live in Accounting > General,
 * where a per-part override already overrides them.
 */
const PARTS_SETTINGS: SidebarProps[] = [
  {
    id: 'parts-settings',
    label: 'Parts',
    type: 'header',
    items: [
      {
        id: 'parts-settings-general',
        label: 'General',
        slug: 'general',
        icon: <SlidersHorizontal />,
        description: 'Whether an order raises a build, and for which parts',
        keywords: ['auto-build', 'production', 'manufacturing', 'orders'],
      },
    ],
  },
]

export default function PartsSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[pages.length - 1]

  return (
    <MainPageContent>
      {/* `md:` must match SidebarSecondary's own breakpoint — at `sm:` the sidebar is
          still in mobile-disclosure mode with no fixed width and collapses to a sliver. */}
      <div className='flex flex-col md:flex-row h-full flex-1 overflow-hidden'>
        <SidebarSecondary
          items={PARTS_SETTINGS}
          baseUrl='/app/parts/settings'
          current={page}
          title='Settings'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </div>
    </MainPageContent>
  )
}
