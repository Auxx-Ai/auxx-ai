'use cache'

// apps/kb/src/app/[orgSlug]/[kbSlug]/page.tsx

import {
  extractKBHeadings,
  getArticleNeighbours,
  KBArticlePager,
  KBArticleRenderer,
  KBTableOfContents,
} from '@auxx/ui/components/kb'
import type { Metadata } from 'next'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound } from 'next/navigation'
import { getKBPayloadWithContent, kbTag } from '../../../server/kb-cache'

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
  const { kb } = await getKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) return { title: 'Not found' }
  return {
    title: kb.name,
    description: kb.description ?? undefined,
    openGraph: { title: kb.name, description: kb.description ?? undefined },
  }
}

export default async function KBLandingPage({ params }: PageProps) {
  const { orgSlug, kbSlug } = await params
  cacheTag(kbTag(orgSlug, kbSlug))
  cacheLife('max')

  const { kb, articles } = await getKBPayloadWithContent(orgSlug, kbSlug)
  if (!kb) notFound()

  const basePath = `/${orgSlug}/${kbSlug}`
  const homeArticle = articles.find((a) => a.isPublished && !a.isCategory)
  const doc = homeArticle?.contentJson ?? null
  const headings = doc ? extractKBHeadings(doc) : []
  const { prev, next } = homeArticle
    ? getArticleNeighbours(articles, homeArticle.id)
    : { prev: undefined, next: undefined }

  return (
    <div className='min-w-0 flex-1'>
      <div className='mx-auto max-w-3xl px-6 pt-4'>
        <KBTableOfContents headings={headings} />
      </div>
      <KBArticleRenderer
        doc={doc}
        title={homeArticle?.title ?? kb.name}
        description={homeArticle?.description ?? kb.description}
        updatedAt={homeArticle?.updatedAt ?? null}
      />
      <div className='mx-auto max-w-3xl px-6'>
        <KBArticlePager articles={articles} prev={prev} next={next} basePath={basePath} />
      </div>
    </div>
  )
}
