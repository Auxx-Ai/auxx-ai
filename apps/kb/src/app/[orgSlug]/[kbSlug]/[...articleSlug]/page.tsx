// apps/kb/src/app/[orgSlug]/[kbSlug]/[...articleSlug]/page.tsx

import { findArticleBySlugPath, KBArticleRenderer } from '@auxx/ui/components/kb'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getKBPayloadWithContent, kbArticleTag, kbTag } from '../../../../server/kb-cache'

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
  const { articles } = await getKBPayloadWithContent(orgSlug, kbSlug)
  const article = findArticleBySlugPath(articles, articleSlug)
  if (!article) return { title: 'Not found' }
  return {
    title: article.title,
    description: article.description ?? undefined,
    openGraph: { title: article.title, description: article.description ?? undefined },
  }
}

export default async function ArticlePage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ArticleBody params={params} />
    </Suspense>
  )
}

async function ArticleBody({
  params,
}: {
  params: Promise<{ orgSlug: string; kbSlug: string; articleSlug: string[] }>
}) {
  'use cache'
  const { orgSlug, kbSlug, articleSlug } = await params
  const slugPath = articleSlug.join('/')
  cacheTag(kbTag(orgSlug, kbSlug), kbArticleTag(orgSlug, kbSlug, slugPath))
  cacheLife('max')

  const { articles } = await getKBPayloadWithContent(orgSlug, kbSlug)
  const article = findArticleBySlugPath(articles, articleSlug)
  if (!article || article.isCategory) notFound()

  return (
    <KBArticleRenderer
      doc={article.contentJson}
      title={article.title}
      description={article.description}
    />
  )
}
