// apps/web/src/app/(protected)/app/contacts/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Contacts page — renders the shared RecordsView for the contacts resource.
 * The contacts `layout.tsx` (EntityRouteLayout) owns the MainPage shell.
 */
export default function ContactsPage() {
  return <RecordsView slug='contacts' basePath='/app/contacts' />
}
