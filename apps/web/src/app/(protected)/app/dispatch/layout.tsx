// apps/web/src/app/(protected)/app/dispatch/layout.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { CalendarDays, Settings } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'

type DispatchTab = 'board' | 'settings'

/**
 * Module header for `/app/dispatch/*` — the tickets-layout recipe
 * (`TicketsLayoutHeader`): a `RadioTab` switcher (Board · Settings) whose
 * active value is derived from the pathname, `router.push` on change.
 */
function DispatchLayoutHeader() {
  const pathname = usePathname()
  const router = useRouter()

  const activeTab: DispatchTab = pathname.includes('/dispatch/settings') ? 'settings' : 'board'

  const handleTabChange = (tab: DispatchTab) => {
    router.push(tab === 'board' ? '/app/dispatch' : '/app/dispatch/settings')
  }

  return (
    <MainPageHeader className='justify-start'>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem title='Dispatch' href='/app/dispatch' last />
      </MainPageBreadcrumb>
      <RadioTab
        value={activeTab}
        onValueChange={handleTabChange}
        size='sm'
        radioGroupClassName='grid w-full'
        className='border border-primary-200 flex w-full'>
        <RadioTabItem value='board' size='sm' tooltip='Board'>
          <CalendarDays />
          <span className='hidden sm:inline'>Board</span>
        </RadioTabItem>
        <RadioTabItem value='settings' size='sm' tooltip='Settings'>
          <Settings />
          <span className='hidden sm:inline'>Settings</span>
        </RadioTabItem>
      </RadioTab>
    </MainPageHeader>
  )
}

/**
 * Module shell for `/app/dispatch/*` — `MainPage` chrome + the Board·Settings
 * header (M2a, 07-m2-build.md §D.1). The board is the module home now; the
 * settings sub-tree (`dispatch/settings/*`) keeps its own secondary sidebar
 * layout untouched.
 */
export default function DispatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <MainPage>
      <DispatchLayoutHeader />
      {children}
    </MainPage>
  )
}
