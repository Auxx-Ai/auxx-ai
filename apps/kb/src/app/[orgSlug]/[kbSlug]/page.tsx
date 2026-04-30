// apps/kb/src/app/[orgSlug]/[kbSlug]/page.tsx

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
import {
  getFullSlugPath,
  getTopLevelTabs,
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
  if (!visibility || visibility.publishStatus === 'DRAFT') {
    return { title: { absolute: 'Not found' } }
  }

  if (visibility.visibility === 'INTERNAL') {
    return { title: { absolute: 'Knowledge base' }, robots: { index: false, follow: false } }
  }

  const { kb } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) return { title: { absolute: 'Not found' } }
  return {
    // Use absolute so the parent layout's "%s | KB Name" template doesn't
    // produce "KB Name | KB Name" on the index page.
    title: { absolute: kb.name },
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
  // KB root routes through the first tab. We pick its first navigable
  // descendant — the deepest first child that isn't itself a tab or header.
  const firstTab = getTopLevelTabs(articles)[0]
  const homeArticle = firstTab ? findFirstNavigableInTab(firstTab.id, articles) : undefined
  if (homeArticle) {
    redirect(`${basePath}/${getFullSlugPath(homeArticle, articles)}`)
  }

  // Empty state — no tabs (impossible at runtime: KBs always have ≥1 tab) or
  // every tab is empty.
  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      <div className='flex flex-col gap-6 @kb-lg:flex-row @kb-lg:items-start'>
        <aside className='w-full max-w-3xl px-6 pt-4 @kb-lg:sticky @kb-lg:top-20 @kb-lg:order-2 @kb-lg:w-64 @kb-lg:max-w-none @kb-lg:flex-none @kb-lg:px-4 @kb-lg:pt-8'>
          <KBTableOfContents headings={[]} />
        </aside>
        <div className='min-w-0 flex-1 @kb-lg:order-1'>
          <KBArticleRenderer
            doc={null}
            title={kb.name}
            emoji={null}
            description={kb.description}
            updatedAt={null}
          />
        </div>
      </div>
      <div className='mt-auto w-full max-w-3xl px-6'>
        <KBArticlePager articles={articles} prev={undefined} next={undefined} basePath={basePath} />
      </div>
    </div>
  )
}

/**
 * Depth-first walk of `rootId`'s children, skipping headers and tabs. Used by
 * the KB root and every tab pill click target.
 */
function findFirstNavigableInTab(
  rootId: string,
  articles: PublicArticleFull[]
): PublicArticleFull | undefined {
  const children = articles
    .filter((a) => a.parentId === rootId && a.isPublished)
    .sort((a, b) => a.order - b.order)
  for (const child of children) {
    if (child.articleKind === 'header') {
      const grand = findFirstNavigableInTab(child.id, articles)
      if (grand) return grand
      continue
    }
    if (child.articleKind === 'tab') continue
    return child
  }
  return undefined
}
