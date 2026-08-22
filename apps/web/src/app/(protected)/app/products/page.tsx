// apps/web/src/app/(protected)/app/products/page.tsx

'use client'

import { RecordsView } from '~/components/records'

export default function ProductsPage() {
  return <RecordsView slug='products' basePath='/app/products' />
}
