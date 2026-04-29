// apps/kb/src/app/[orgSlug]/[kbSlug]/[...articleSlug]/page.tsx

import { findArticleBySlugPath, KBArticleRenderer } from '@auxx/ui/components/kb'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { getKBPayloadWithContent, kbArticleTag, kbTag } from '../../../../server/kb-cache'

interface PageProps {
  params: Promise<{ orgSlug: string; kbSlug: string; articleSlug: string[] }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, kbSlug, articleSlug } = await params
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
