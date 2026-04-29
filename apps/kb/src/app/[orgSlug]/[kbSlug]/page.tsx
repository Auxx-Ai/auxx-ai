// apps/kb/src/app/[orgSlug]/[kbSlug]/page.tsx

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
import {
  extractKBHeadings,
  getArticleNeighbours,
  KBArticlePager,
  KBArticleRenderer,
  KBTableOfContents,
} from '@auxx/ui/components/kb'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getLocalSession, getLoginUrl } from '~/lib/auth'
import {
  getCachedKBVisibility,
  getPublicKBPayloadWithContent,
  kbTag,
} from '../../../server/kb-cache'
import {
  loadKBPayloadWithContent,
  type PublicArticleFull,
  type PublicKB,
} from '../../../server/kb-data'

interface PageProps {
  params: Promise<{ orgSlug: string; kbSlug: string }>
}

// KBs are entirely tenant-specific. Provide a stub so cacheComponents can
// validate the route shape; real requests render at runtime and are cached.
export async function generateStaticParams() {
  return [{ orgSlug: '__build__', kbSlug: '__build__' }]
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, kbSlug } = await params
  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') return { title: 'Not found' }

  if (visibility.visibility === 'INTERNAL') {
    return { title: 'Knowledge base', robots: { index: false, follow: false } }
  }

  const { kb } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) return { title: 'Not found' }
  return {
    title: kb.name,
    description: kb.description ?? undefined,
    openGraph: { title: kb.name, description: kb.description ?? undefined },
    robots: kb.publishStatus === 'UNLISTED' ? { index: false, follow: false } : undefined,
  }
}

export default async function KBLandingPage({ params }: PageProps) {
  const { orgSlug, kbSlug } = await params

  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') notFound()

  if (visibility.visibility === 'PUBLIC') {
    return <PublicLanding orgSlug={orgSlug} kbSlug={kbSlug} />
  }

  return (
    <Suspense fallback={null}>
      <InternalLandingGate
        orgSlug={orgSlug}
        kbSlug={kbSlug}
        kbId={visibility.id}
        organizationId={visibility.organizationId}
      />
    </Suspense>
  )
}

async function PublicLanding({ orgSlug, kbSlug }: { orgSlug: string; kbSlug: string }) {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')

  const { kb, articles } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) notFound()
  return <LandingBody kb={kb} articles={articles} orgSlug={orgSlug} kbSlug={kbSlug} />
}

async function InternalLandingGate({
  orgSlug,
  kbSlug,
  kbId,
  organizationId,
}: {
  orgSlug: string
  kbSlug: string
  kbId: string
  organizationId: string
}) {
  const session = await getLocalSession()
  if (!session) {
    redirect(getLoginUrl(kbId, `/${orgSlug}/${kbSlug}`))
  }
  const member = await isOrgMember(organizationId, session.userId)
  if (!member) {
    redirect(`${WEBAPP_URL}/kb-auth/no-access`)
  }

  const { kb, articles } = await loadKBPayloadWithContent(orgSlug, kbSlug, {
    session: { userId: session.userId },
  })
  if (!kb) notFound()

  return <LandingBody kb={kb} articles={articles} orgSlug={orgSlug} kbSlug={kbSlug} />
}

function LandingBody({
  kb,
  articles,
  orgSlug,
  kbSlug,
}: {
  kb: PublicKB
  articles: PublicArticleFull[]
  orgSlug: string
  kbSlug: string
}) {
  const basePath = `/${orgSlug}/${kbSlug}`
  const homeArticle =
    articles.find((a) => a.isHomePage && a.isPublished && !a.isCategory) ??
    articles.find((a) => a.isPublished && !a.isCategory)
  const doc = homeArticle?.contentJson ?? null
  const headings = doc ? extractKBHeadings(doc) : []
  const { prev, next } = homeArticle
    ? getArticleNeighbours(articles, homeArticle.id)
    : { prev: undefined, next: undefined }

  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      <div className='w-full max-w-3xl px-6 pt-4'>
        <KBTableOfContents headings={headings} />
      </div>
      <KBArticleRenderer
        doc={doc}
        title={homeArticle?.title ?? kb.name}
        description={homeArticle?.description ?? kb.description}
        updatedAt={homeArticle?.updatedAt ?? null}
      />
      <div className='mt-auto w-full max-w-3xl px-6'>
        <KBArticlePager articles={articles} prev={prev} next={next} basePath={basePath} />
      </div>
    </div>
  )
}
