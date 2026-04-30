// apps/web/src/app/(protected)/app/kb/page.tsx

import { redirect } from 'next/navigation'
import { KBEmptyState } from '~/components/kb/ui/dialogs/kb-empty-state'
import { api } from '~/trpc/server'

export default async function KBMain() {
  const knowledgeBases = await api.kb.list()

  if (knowledgeBases && knowledgeBases.length > 0) {
    redirect(`/app/kb/${knowledgeBases[0].id}/editor`)
  }

  return <KBEmptyState />
}
