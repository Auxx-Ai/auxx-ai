// apps/kb/src/app/[orgSlug]/[kbSlug]/page.tsx

import { KBArticleRenderer } from '@auxx/ui/components/kb'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { getKBPayloadWithContent, kbTag } from '../../../server/kb-cache'

interface PageProps {
  params: Promise<{ orgSlug: string; kbSlug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, kbSlug } = await params
  const { kb } = await getKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) return { title: 'Not found' }
  return {
    title: kb.name,
    description: kb.description ?? undefined,
    openGraph: { title: kb.name, description: kb.description ?? undefined },
  }
}

export default async function KBLandingPage({ params }: PageProps) {
  'use cache'
  const { orgSlug, kbSlug } = await params
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')

  const { kb, articles } = await getKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) notFound()

  const homeArticle = articles.find((a) => a.isPublished && !a.isCategory)
  const doc = homeArticle?.contentJson ?? null

  return (
    <KBArticleRenderer
      doc={doc}
      title={homeArticle?.title ?? kb.name}
      description={homeArticle?.description ?? kb.description}
    />
  )
}
