// apps/kb/src/app/[orgSlug]/[kbSlug]/layout.tsx

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
import { KBLayout } from '@auxx/ui/components/kb'
import type { KBMode } from '@auxx/ui/components/kb/theme'
import '@auxx/ui/global.css'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getLocalSession, getLoginUrl } from '~/lib/auth'
import { getCachedKBVisibility, getPublicKBPayload, kbTag } from '../../../server/kb-cache'
import { loadKBPayload } from '../../../server/kb-data'

interface KBSlugLayoutProps {
  params: Promise<{ orgSlug: string; kbSlug: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: KBSlugLayoutProps): Promise<Metadata> {
  const { orgSlug, kbSlug } = await params
  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') return {}
  // Keep internal KB names out of the tab title.
  if (visibility.visibility === 'INTERNAL') {
    return { title: { template: '%s | Knowledge base', default: 'Knowledge base' } }
  }
  const { kb } = await getPublicKBPayload(orgSlug, kbSlug)
  if (!kb) return {}
  return { title: { template: `%s | ${kb.name}`, default: kb.name } }
}

export default async function KBSlugLayout({ params, children }: KBSlugLayoutProps) {
  const { orgSlug, kbSlug } = await params

  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') notFound()

  const mode = await readModeCookie(visibility.id)

  if (visibility.visibility === 'PUBLIC') {
    return (
      <PublicKBLayout orgSlug={orgSlug} kbSlug={kbSlug} mode={mode}>
        {children}
      </PublicKBLayout>
    )
  }

  // INTERNAL: dynamic — auth gate inside Suspense so the cacheComponents
  // model is satisfied (uncached cookie/membership reads are streamed).
  return (
    <Suspense fallback={null}>
      <InternalKBLayoutGate
        orgSlug={orgSlug}
        kbSlug={kbSlug}
        kbId={visibility.id}
        organizationId={visibility.organizationId}
        mode={mode}>
        {children}
      </InternalKBLayoutGate>
    </Suspense>
  )
}

async function readModeCookie(kbId: string): Promise<KBMode | undefined> {
  const cookieStore = await cookies()
  const value = cookieStore.get(`kb-mode-${kbId}`)?.value
  return value === 'dark' ? 'dark' : value === 'light' ? 'light' : undefined
}

async function PublicKBLayout({
  orgSlug,
  kbSlug,
  mode,
  children,
}: {
  orgSlug: string
  kbSlug: string
  mode?: KBMode
  children: React.ReactNode
}) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')

  const { kb, articles } = await getPublicKBPayload(orgSlug, kbSlug)
  if (!kb) notFound()

  const basePath = `/${orgSlug}/${kbSlug}`
  const searchOrigin = `${basePath}/search.json`

  return (
    <KBLayout
      kb={kb}
      articles={articles}
      basePath={basePath}
      searchOrigin={searchOrigin}
      mode={mode}>
      {children}
    </KBLayout>
  )
}

async function InternalKBLayoutGate({
  orgSlug,
  kbSlug,
  kbId,
  organizationId,
  mode,
  children,
}: {
  orgSlug: string
  kbSlug: string
  kbId: string
  organizationId: string
  mode?: KBMode
  children: React.ReactNode
}) {
  const session = await getLocalSession()
  if (!session) {
    redirect(getLoginUrl(kbId, `/${orgSlug}/${kbSlug}`))
  }
  const member = await isOrgMember(organizationId, session.userId)
  if (!member) {
    redirect(`${WEBAPP_URL}/kb-auth/no-access`)
  }

  const { kb, articles } = await loadKBPayload(orgSlug, kbSlug, {
    session: { userId: session.userId },
  })
  if (!kb) notFound()

  const basePath = `/${orgSlug}/${kbSlug}`
  const searchOrigin = `${basePath}/search.json`

  return (
    <KBLayout
      kb={kb}
      articles={articles}
      basePath={basePath}
      searchOrigin={searchOrigin}
      mode={mode}>
      {children}
    </KBLayout>
  )
}
