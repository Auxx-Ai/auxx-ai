// apps/kb/src/app/[orgSlug]/[kbSlug]/layout.tsx

import { KBLayout } from '@auxx/ui/components/kb'
import '@auxx/ui/global.css'
import { notFound } from 'next/navigation'
import { getKBPayload } from '../../../server/kb-cache'

interface KBSlugLayoutProps {
  params: Promise<{ orgSlug: string; kbSlug: string }>
  children: React.ReactNode
}

export default async function KBSlugLayout({ params, children }: KBSlugLayoutProps) {
  const { orgSlug, kbSlug } = await params
  const { kb, articles } = await getKBPayload(orgSlug, kbSlug)
  if (!kb) notFound()

  const basePath = `/${orgSlug}/${kbSlug}`
  const searchOrigin = `${basePath}/_search.json`

  return (
    <KBLayout kb={kb} articles={articles} basePath={basePath} searchOrigin={searchOrigin}>
      {children}
    </KBLayout>
  )
}
