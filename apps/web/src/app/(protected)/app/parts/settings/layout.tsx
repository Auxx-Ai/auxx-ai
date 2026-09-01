// apps/web/src/app/(protected)/app/parts/settings/layout.tsx

'use client'

import { MainPageContent } from '@auxx/ui/components/main-page'
import { Globe, SlidersHorizontal } from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/**
 * Parts settings navigation (25-parts-settings-tab.md §3).
 *
 * General owns the auto-build switch, the only org SETTING the parts domain has:
 * receiving has none, and the `manufacturing.*` absorption rates live in
 * Accounting > General, where a per-part override already overrides them.
 *
 * Tariffs is not a settings catalog page at all - it edits `tariff_code` and
 * `tariff_rate` records (29-tariff-schedule.md §6.1), which is why it gates on
 * the record capability rather than on `settingsManage` like its neighbour.
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
      {
        id: 'parts-settings-tariffs',
        label: 'Tariffs',
        slug: 'tariffs',
        icon: <Globe />,
        description: 'Harmonized codes by country of origin, and the rates behind them',
        keywords: ['hs code', 'hts', 'duty', 'customs', 'harmonized', 'section 301'],
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
