// apps/web/src/app/(protected)/app/quotes/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Quotes page — renders the shared RecordsView for the quotes resource
 */
export default function QuotesPage() {
  return <RecordsView slug='quotes' basePath='/app/quotes' />
}
