// apps/web/src/app/(protected)/app/tickets/settings/layout.tsx

'use client'

import { WEBAPP_URL } from '@auxx/config/client'
import { MainPageContent } from '@auxx/ui/components/main-page'
import { BookTemplate, Mail, Ticket } from 'lucide-react'
import { usePathname } from 'next/navigation'
import SidebarSecondary from '~/components/global/sidebar-secondary'
import type { SidebarProps } from '~/constants/menu'

/** Settings navigation items */
const TICKET_SETTINGS: SidebarProps[] = [
  {
    id: 'tickets-settings',
    label: 'Settings',
    type: 'header',
    items: [
      { id: 'tickets-settings-format', label: 'Ticket Format', slug: 'format', icon: <Ticket /> },
      { id: 'tickets-settings-domain', label: 'Domains', slug: 'domains', icon: <Mail /> },
      {
        id: 'tickets-settings-templates',
        label: 'Templates',
        slug: 'templates',
        icon: <BookTemplate />,
      },
    ],
  },
]

/**
 * Settings layout with secondary sidebar navigation
 */
export default function TicketSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const pages = pathname.split('/')
  const page = pages[pages.length - 1]

  const baseUrl = `${WEBAPP_URL}/app/tickets/settings`

  return (
    <MainPageContent>
      <div className='flex h-full flex-1 overflow-hidden'>
        <SidebarSecondary
          items={TICKET_SETTINGS}
          baseUrl={baseUrl}
          current={page}
          title='Settings'
        />
        <div className='relative flex h-full w-full flex-1 grow overflow-hidden'>{children}</div>
      </div>
    </MainPageContent>
  )
}
