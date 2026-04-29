// apps/kb/src/app/[orgSlug]/[kbSlug]/[...articleSlug]/page.tsx

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
import {
  extractKBHeadings,
  findArticleBySlugPath,
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
  kbArticleTag,
  kbTag,
} from '../../../../server/kb-cache'
import { loadKBPayloadWithContent, type PublicArticleFull } from '../../../../server/kb-data'

interface PageProps {
  params: Promise<{ orgSlug: string; kbSlug: string; articleSlug: string[] }>
}

// Articles are entirely tenant-specific, so we have no real paths to prerender
// at build time. cacheComponents requires at least one stub. The placeholder
// renders a 404 page (no real article matches "__build__"), and all real
// requests render at runtime and are cached by 'use cache' + cacheTag.
export async function generateStaticParams() {
  return [{ orgSlug: '__build__', kbSlug: '__build__', articleSlug: ['__build__'] }]
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, kbSlug, articleSlug } = await params

  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') return { title: 'Not found' }

  if (visibility.visibility === 'INTERNAL') {
    return { title: 'Knowledge base', robots: { index: false, follow: false } }
  }
  return getCachedMetadata(orgSlug, kbSlug, articleSlug)
}

async function getCachedMetadata(
  orgSlug: string,
  kbSlug: string,
  articleSlug: string[]
): Promise<Metadata> {
  'use cache'
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')
  const { kb, articles } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  const article = findArticleBySlugPath(articles, articleSlug)
  if (!article) return { title: 'Not found' }
  return {
    title: article.title,
    description: article.description ?? undefined,
    openGraph: { title: article.title, description: article.description ?? undefined },
    robots: kb?.publishStatus === 'UNLISTED' ? { index: false, follow: false } : undefined,
  }
}

export default async function ArticlePage({ params }: PageProps) {
  const { orgSlug, kbSlug, articleSlug } = await params

  const visibility = await getCachedKBVisibility(orgSlug, kbSlug)
  if (!visibility || visibility.publishStatus === 'DRAFT') notFound()

  if (visibility.visibility === 'PUBLIC') {
    return (
      <Suspense fallback={null}>
        <PublicArticleBody orgSlug={orgSlug} kbSlug={kbSlug} articleSlug={articleSlug} />
      </Suspense>
    )
  }

  return (
    <Suspense fallback={null}>
      <InternalArticleGate
        orgSlug={orgSlug}
        kbSlug={kbSlug}
        articleSlug={articleSlug}
        kbId={visibility.id}
        organizationId={visibility.organizationId}
      />
    </Suspense>
  )
}

async function PublicArticleBody({
  orgSlug,
  kbSlug,
  articleSlug,
}: {
  orgSlug: string
  kbSlug: string
  articleSlug: string[]
}) {
  'use cache'
  const slugPath = articleSlug.join('/')
  cacheTag(kbTag(orgSlug, kbSlug), kbArticleTag(orgSlug, kbSlug, slugPath))
  cacheLife('max')

  const { articles } = await getPublicKBPayloadWithContent(orgSlug, kbSlug)
  return (
    <ArticleBodyContent
      articles={articles}
      orgSlug={orgSlug}
      kbSlug={kbSlug}
      articleSlug={articleSlug}
    />
  )
}

async function InternalArticleGate({
  orgSlug,
  kbSlug,
  articleSlug,
  kbId,
  organizationId,
}: {
  orgSlug: string
  kbSlug: string
  articleSlug: string[]
  kbId: string
  organizationId: string
}) {
  const session = await getLocalSession()
  if (!session) {
    redirect(getLoginUrl(kbId, `/${orgSlug}/${kbSlug}/${articleSlug.join('/')}`))
  }
  const member = await isOrgMember(organizationId, session.userId)
  if (!member) {
    redirect(`${WEBAPP_URL}/kb-auth/no-access`)
  }

  const { articles } = await loadKBPayloadWithContent(orgSlug, kbSlug, {
    session: { userId: session.userId },
  })
  return (
    <ArticleBodyContent
      articles={articles}
      orgSlug={orgSlug}
      kbSlug={kbSlug}
      articleSlug={articleSlug}
    />
  )
}

function ArticleBodyContent({
  articles,
  orgSlug,
  kbSlug,
  articleSlug,
}: {
  articles: PublicArticleFull[]
  orgSlug: string
  kbSlug: string
  articleSlug: string[]
}) {
  const basePath = `/${orgSlug}/${kbSlug}`
  const article = findArticleBySlugPath(articles, articleSlug)
  if (!article || article.isCategory) notFound()

  const headings = extractKBHeadings(article.contentJson)
  const { prev, next } = getArticleNeighbours(articles, article.id)

  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      <div className='w-full max-w-3xl px-6 pt-4'>
        <KBTableOfContents headings={headings} />
      </div>
      <KBArticleRenderer
        doc={article.contentJson}
        title={article.title}
        description={article.description}
        updatedAt={article.updatedAt}
      />
      <div className='mt-auto w-full max-w-3xl px-6'>
        <KBArticlePager articles={articles} prev={prev} next={next} basePath={basePath} />
      </div>
    </div>
  )
}
