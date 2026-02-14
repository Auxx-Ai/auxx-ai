// 'use client'

import { redirect } from 'next/navigation'
import { api } from '~/trpc/server'
import KBEditorView from './_components/kb-editor-view'

type Props = {}

export default async function KBMain({}: Props) {
  const knowledgeBases = await api.kb.list()
  // const router = useRouter()
  if (knowledgeBases && knowledgeBases.length > 0) {
    redirect(`/app/kb/${knowledgeBases[0].id}/editor/general`)
    return null
    // return <KBEditorView knowledgeBaseId={knowledgeBases[0].id} slug={[]} />
  }
  // console.log('Result:', result)
  return <KBEditorView knowledgeBaseId={undefined} slug={[]} />
}
