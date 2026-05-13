// apps/web/src/app/(protected)/app/kb/page.tsx

import { ArticlesView } from '~/components/kb/ui/articles/articles-view'
import { KBEmptyState } from '~/components/kb/ui/dialogs/kb-empty-state'
import { api } from '~/trpc/server'

export default async function KBMain() {
  const knowledgeBases = await api.kb.list()

  if (!knowledgeBases || knowledgeBases.length === 0) {
    return <KBEmptyState />
  }

  return <ArticlesView />
}
