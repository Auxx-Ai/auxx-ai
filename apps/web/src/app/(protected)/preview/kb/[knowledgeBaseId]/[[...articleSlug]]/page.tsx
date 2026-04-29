// apps/web/src/app/(protected)/preview/kb/[knowledgeBaseId]/[[...articleSlug]]/page.tsx

import { KnowledgeBaseProvider } from '~/components/kb'
import { KBFullscreenPreview } from '~/components/kb/ui/preview/kb-fullscreen-preview'

interface PageProps {
  params: Promise<{ knowledgeBaseId: string; articleSlug?: string[] }>
}

export default async function KBFullscreenPreviewPage({ params }: PageProps) {
  const { knowledgeBaseId, articleSlug = [] } = await params

  return (
    <KnowledgeBaseProvider knowledgeBaseId={knowledgeBaseId}>
      <KBFullscreenPreview knowledgeBaseId={knowledgeBaseId} slugPath={articleSlug} />
    </KnowledgeBaseProvider>
  )
}
