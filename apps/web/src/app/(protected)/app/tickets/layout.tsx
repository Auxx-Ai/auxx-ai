// apps/web/src/app/(protected)/app/tickets/layout.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { ChartColumn, Plus, Settings, Tags } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { parseAsBoolean, parseAsStringLiteral, useQueryState } from 'nuqs'

/** Ticket tab types for navigation */
type TicketTab = 'list' | 'dashboard' | 'settings'

/** Dashboard period options */
const PERIOD_OPTIONS = ['day', 'week', 'month', 'year'] as const
export type DashboardPeriod = (typeof PERIOD_OPTIONS)[number]

/**
 * Header component with RadioTab navigation for tickets section
 * Uses URL query state directly for create dialog (no TicketProvider)
 */
function TicketsLayoutHeader() {
  const pathname = usePathname()
  const router = useRouter()

  // Create dialog state via URL query param
  const [, setCreateDialogOpen] = useQueryState('create', parseAsBoolean.withDefault(false))

  // Dashboard period state (shared via URL)
  const [period, setPeriod] = useQueryState(
    'period',
    parseAsStringLiteral(PERIOD_OPTIONS).withDefault('week')
  )

  /** Determine active tab from current pathname */
  const getActiveTab = (): TicketTab => {
    if (pathname.includes('/tickets/settings')) return 'settings'
    if (pathname.includes('/tickets/dashboard')) return 'dashboard'
    return 'list'
  }

  const activeTab = getActiveTab()

  /** Handle tab navigation */
  const handleTabChange = (tab: TicketTab) => {
    switch (tab) {
      case 'list':
        router.push('/app/tickets')
        break
      case 'dashboard':
        router.push('/app/tickets/dashboard')
        break
      case 'settings':
        router.push('/app/tickets/settings')
        break
    }
  }

  return (
    <MainPageHeader
      className='justify-start'
      action={
        <div className='flex items-center gap-2'>
          <RadioTab
            value={activeTab}
            onValueChange={handleTabChange}
            size='sm'
            radioGroupClassName='grid w-full'
            className='border border-primary-200 flex flex-1 w-full'>
            <RadioTabItem value='list' size='sm' tooltip='Tickets'>
              <Tags />
              <span className='hidden sm:inline'>Tickets</span>
            </RadioTabItem>
            <RadioTabItem value='dashboard' size='sm' tooltip='Dashboard'>
              <ChartColumn />
              <span className='hidden sm:inline'>Dashboard</span>
            </RadioTabItem>
            <RadioTabItem value='settings' size='sm' tooltip='Settings'>
              <Settings />
              <span className='hidden sm:inline'>Settings</span>
            </RadioTabItem>
          </RadioTab>
          {activeTab === 'list' && (
            <Button
              variant='info'
              size='sm'
              className='px-2'
              onClick={() => setCreateDialogOpen(true)}>
              <Plus />
              <span className='hidden sm:inline'>New Ticket</span>
              <KbdGroup variant='default' size='sm'>
                <Kbd>c</Kbd>
                <Kbd>t</Kbd>
              </KbdGroup>
            </Button>
          )}
          {activeTab === 'dashboard' && (
            <Select value={period} onValueChange={(value: DashboardPeriod) => setPeriod(value)}>
              <SelectTrigger className='w-[140px]'>
                <SelectValue placeholder='Select period' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='day'>Today</SelectItem>
                <SelectItem value='week'>This Week</SelectItem>
                <SelectItem value='month'>This Month</SelectItem>
                <SelectItem value='year'>This Year</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      }>
      <MainPageBreadcrumb>
        <MainPageBreadcrumbItem title='Support Tickets' href='/app/tickets' last />
      </MainPageBreadcrumb>
    </MainPageHeader>
  )
}

/**
 * Shared layout for tickets section with conditional rendering
 * - For tabbed pages (list, dashboard, settings): renders MainPage with RadioTab header
 * - For detail/create pages: renders children only (they have their own layout)
 *
 * Note: TicketProvider has been removed - data is now managed by useRecordList
 */
export default function TicketsLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  const pathname = usePathname()

  // Check if we're on a ticket detail page, create page, or import page
  // These pages have their own MainPage wrapper or don't need the RadioTab header
  const isDetailOrSpecialPage =
    /\/tickets\/[^/]+$/.test(pathname) &&
    !pathname.endsWith('/tickets') &&
    !pathname.includes('/dashboard') &&
    !pathname.includes('/settings')

  // For detail/create/import pages, just render children (they have their own layout)
  if (isDetailOrSpecialPage) {
    return (
      <>
        {children}
        {modal}
      </>
    )
  }

  // For tabbed pages, render with shared header
  // Note: MainPageContent is rendered by child pages to support docking
  return (
    <MainPage>
      <TicketsLayoutHeader />
      {children}
      {modal}
    </MainPage>
  )
}
