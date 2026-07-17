// apps/web/src/app/(protected)/app/parts/page.tsx

'use client'

import { RecordsView } from '~/components/records'

export default function PartsPage() {
  return <RecordsView slug='parts' basePath='/app/parts' />
}
