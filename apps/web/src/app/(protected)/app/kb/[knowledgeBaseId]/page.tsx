// app/kb/[knowledgeBaseId]/page.tsx

import { redirect } from 'next/navigation'

type KBIndexParams = {
  params: Promise<{ knowledgeBaseId: string }>
}

/**
 * The per-KB landing is the editor. The bare `/app/kb/<id>` URL has no page of
 * its own, so forward it to the editor root (which resolves the home article).
 */
export default async function KBIndexPage({ params }: KBIndexParams) {
  const { knowledgeBaseId } = await params
  redirect(`/app/kb/${knowledgeBaseId}/editor`)
}
