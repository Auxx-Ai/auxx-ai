// app/kb/[knowledgeBaseId]/editor/[...slug]/page.tsx

import { KnowledgeBaseProvider } from '~/components/kb'
import { KBEditorShell } from '~/components/kb/ui/editor/kb-editor-shell'

type KBEditorParams = {
  params: Promise<{ knowledgeBaseId: string; slug?: string[] }>
}

export default async function KBEditorPage({ params }: KBEditorParams) {
  const { knowledgeBaseId, slug = [] } = await params

  // Strip the literal `~` separator that's part of the URL convention.
  const cleanSlug = slug.length > 0 && slug[0] === '~' ? slug.slice(1) : slug

  return (
    <KnowledgeBaseProvider knowledgeBaseId={knowledgeBaseId}>
      <KBEditorShell knowledgeBaseId={knowledgeBaseId} slug={cleanSlug} />
    </KnowledgeBaseProvider>
  )
}
