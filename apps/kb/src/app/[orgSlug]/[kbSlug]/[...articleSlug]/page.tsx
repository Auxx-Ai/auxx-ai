// apps/kb/src/app/[orgSlug]/[kbSlug]/[...articleSlug]/page.tsx

import { WEBAPP_URL } from '@auxx/config/urls'
import { isOrgMember } from '@auxx/lib/cache'
import {
  extractKBHeadings,
  findArticleBySlugPath,
  findFirstNavigableUnder,
  getArticleNeighbours,
  getArticleParentLink,
  getFullSlugPath,
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
  if (!visibility || visibility.publishStatus === 'DRAFT') {
    return { title: { absolute: 'Not found' } }
  }

  if (visibility.visibility === 'INTERNAL') {
    return { title: { absolute: 'Knowledge base' }, robots: { index: false, follow: false } }
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
  if (!article) return { title: { absolute: 'Not found' } }
  return {
    // Bare string -- the parent layout's "%s | KB Name" template fills in the suffix.
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
  if (!article) notFound()
  // Tabs and headers are pure containers; redirect to the first navigable
  // descendant (308) or 404 if the container is empty.
  if (article.articleKind === 'tab' || article.articleKind === 'header') {
    const first = findFirstNavigableUnder(article.id, articles, { publishedOnly: true })
    if (!first) notFound()
    redirect(`${basePath}/${getFullSlugPath(first, articles)}`)
  }

  const headings = extractKBHeadings(article.contentJson)
  const { prev, next } = getArticleNeighbours(articles, article.id)
  const parent = getArticleParentLink(article, articles, basePath)

  return (
    <div className='flex min-w-0 flex-1 flex-col'>
      <div className='flex flex-col gap-6 @kb-lg:flex-row @kb-lg:items-start'>
        <aside className='hidden @kb-lg:sticky @kb-lg:top-20 @kb-lg:order-2 @kb-lg:block @kb-lg:max-h-[calc(100dvh-5rem)] @kb-lg:w-64 @kb-lg:max-w-none @kb-lg:flex-none @kb-lg:overflow-y-auto @kb-lg:px-4 @kb-lg:pt-8'>
          <KBTableOfContents headings={headings} />
        </aside>
        <div className='min-w-0 flex-1 @kb-lg:order-1'>
          <KBArticleRenderer
            doc={article.contentJson}
            title={article.title}
            emoji={article.emoji}
            description={article.description}
            updatedAt={article.updatedAt}
            parent={parent}
          />
        </div>
      </div>
      <div className='mt-auto w-full max-w-3xl px-6'>
        <KBArticlePager articles={articles} prev={prev} next={next} basePath={basePath} />
      </div>
    </div>
  )
}
