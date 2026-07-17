// apps/web/src/app/(protected)/app/contacts/layout.tsx

'use client'

import { usePathname } from 'next/navigation'
import { EntityRouteLayout } from '~/components/records'

type Props = { children: React.ReactNode; modal: React.ReactNode }

const BASE_PATH = '/app/contacts'

/**
 * Contacts layout — entity route shell (List | Dashboard tabs) for the list
 * and dashboard pages. Detail (`[contactId]`) and import (`import/[jobId]`)
 * routes own their own `MainPage` (via `DetailView`/`ImportPage`) and bypass
 * the shell entirely.
 */
function ContactsLayout({ children, modal }: Props) {
  const pathname = usePathname()
  const isDetailOrSpecialPage =
    pathname !== BASE_PATH && !pathname.startsWith(`${BASE_PATH}/dashboard`)

  if (isDetailOrSpecialPage) {
    return (
      <>
        {children}
        {modal}
      </>
    )
  }

  return (
    <EntityRouteLayout slug='contacts' basePath={BASE_PATH}>
      {children}
      {modal}
    </EntityRouteLayout>
  )
}

export default ContactsLayout
