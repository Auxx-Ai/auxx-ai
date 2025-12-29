// import React from 'react'
// import KBEditorView from '../../../_components/kb-editor-view'

import { Skeleton } from '@auxx/ui/components/skeleton'
import { KBProvider } from '../../../_components/kb-context'
import { KBSidebar } from '../../../_components/kb-sidebar'
import KBEditorView, { KBEditorContent } from '../../../_components/kb-content'

// type KBEditorParams = {
//   params: Promise<{ knowledgeBaseId: string; slug: string[] }>
// }

// async function KBEditorViewPage({ params }: KBEditorParams) {
//   let { knowledgeBaseId, slug = [] } = await params

//   const processedSlug =
//     slug.length > 0 && slug[0] === '~' ? slug.slice(1) : slug

//   return <KBEditorView knowledgeBaseId={knowledgeBaseId} slug={processedSlug} />
// }

// export default KBEditorViewPage

// app/kb/[knowledgeBaseId]/editor/[...slug]/page.tsx

type KBEditorParams = {
  params: Promise<{ knowledgeBaseId: string; slug: string[] }>
}

// The main component that sets up the provider
export default async function KBEditorPage({ params }: KBEditorParams) {
  const { knowledgeBaseId, slug = [] } = await params

  return <KBEditorView knowledgeBaseId={knowledgeBaseId} slug={slug} />
}
