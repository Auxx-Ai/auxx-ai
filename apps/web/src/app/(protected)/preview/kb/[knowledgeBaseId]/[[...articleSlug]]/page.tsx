// apps/web/src/app/(protected)/preview/kb/[knowledgeBaseId]/[[...articleSlug]]/page.tsx

import { KnowledgeBaseProvider } from '~/components/kb'
import type { PreviewMode } from '~/components/kb/hooks/use-article-content'
import { KBFullscreenPreview } from '~/components/kb/ui/preview/kb-fullscreen-preview'

interface PageProps {
  params: Promise<{ knowledgeBaseId: string; articleSlug?: string[] }>
  searchParams: Promise<{ v?: string | string[] }>
}

function parsePreviewMode(raw: string | string[] | undefined): PreviewMode {
  if (!raw || Array.isArray(raw)) return 'draft'
  if (raw === 'draft') return 'draft'
  if (raw === 'live' || raw === 'published') return 'live'
  const n = Number.parseInt(raw, 10)
  if (Number.isFinite(n) && n > 0) return { versionNumber: n }
  return 'draft'
}

export default async function KBFullscreenPreviewPage({ params, searchParams }: PageProps) {
  const { knowledgeBaseId, articleSlug = [] } = await params
  const { v } = await searchParams
  const mode = parsePreviewMode(v)

  return (
    <KnowledgeBaseProvider knowledgeBaseId={knowledgeBaseId}>
      <KBFullscreenPreview knowledgeBaseId={knowledgeBaseId} slugPath={articleSlug} mode={mode} />
    </KnowledgeBaseProvider>
  )
}
