// app/kb/[knowledgeBaseId]/editor/layout.tsx
import type React from 'react'
import { KnowledgeBaseProvider } from '~/components/kb'
import { KBEditorFrame } from '~/components/kb/ui/editor/kb-editor-frame'

type Props = {
  children: React.ReactNode
  params: Promise<{ knowledgeBaseId: string }>
}

/**
 * Route segment layout for the KB editor. Mounts the article-store provider
 * and the persistent chrome (sidebar + header) once per knowledgeBaseId.
 * Only `page.tsx` (the right-pane editor body) suspends on slug change, so
 * the sidebar's scroll position survives article navigation.
 */
export default async function KBEditorLayout({ children, params }: Props) {
  const { knowledgeBaseId } = await params

  return (
    <KnowledgeBaseProvider knowledgeBaseId={knowledgeBaseId}>
      <KBEditorFrame knowledgeBaseId={knowledgeBaseId}>{children}</KBEditorFrame>
    </KnowledgeBaseProvider>
  )
}
