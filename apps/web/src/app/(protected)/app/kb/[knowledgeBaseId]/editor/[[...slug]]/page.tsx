// app/kb/[knowledgeBaseId]/editor/[[...slug]]/page.tsx

import { KBEditorPageBody } from '~/components/kb/ui/editor/kb-editor-page-body'

type KBEditorParams = {
  params: Promise<{ knowledgeBaseId: string; slug?: string[] }>
}

export default async function KBEditorPage({ params }: KBEditorParams) {
  const { knowledgeBaseId, slug = [] } = await params

  // Strip the literal `~` separator that's part of the URL convention.
  const cleanSlug = slug.length > 0 && slug[0] === '~' ? slug.slice(1) : slug

  return <KBEditorPageBody knowledgeBaseId={knowledgeBaseId} slug={cleanSlug} />
}
