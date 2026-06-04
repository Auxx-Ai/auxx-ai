// apps/web/src/components/kb/ui/sidebar/link-article-picker.tsx
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { ArticlePicker } from '../articles/article-picker'

interface LinkArticlePickerProps {
  knowledgeBaseId: string
  /** Article the linked articles nest under (the active tab); null = KB root. */
  targetParentArticleId: string | null
  /** Dismiss the surface hosting this picker (dropdown/popover). */
  onClose: () => void
}

/**
 * The cross-KB article picker used to link `page` articles from any KB into this one.
 * Surface-agnostic — embed it inside a dropdown or popover. The picker lists every KB you
 * can pull from (other standard KBs + sources' hidden KBs), you drill in and pick articles,
 * and each pick adds an `ArticlePlacement` under the active tab. Linking a source article
 * keeps it managed (read-only); linking a plain article is a true multi-home (one `Article`,
 * edited in either KB edits both). Articles already in this KB are filtered out.
 */
export function LinkArticlePicker({
  knowledgeBaseId,
  targetParentArticleId,
  onClose,
}: LinkArticlePickerProps) {
  const utils = api.useUtils()
  const kbs = api.kb.list.useQuery()
  const sources = api.knowledgeSource.list.useQuery()

  // KBs to pull from: standard KBs (minus this one) + each source's hidden KB
  // (excluding ai-only sources, which surface no articles).
  const knowledgeBasesOverride = useMemo(() => {
    const standard = (kbs.data ?? [])
      .filter((kb) => kb.id !== knowledgeBaseId)
      .map((kb) => ({ id: kb.id, name: kb.name || 'Untitled' }))
    const sourceKbs = (sources.data ?? [])
      .filter((s) => s.surface !== 'ai-only')
      .map((s) => ({ id: s.ownedKnowledgeBaseId, name: s.name }))
    return [...standard, ...sourceKbs]
  }, [kbs.data, sources.data, knowledgeBaseId])

  // Articles already placed in this KB — hidden from the picker (the shared article id is
  // the dedupe key). Tracks just-linked ids locally so they vanish before the refetch lands.
  const currentArticles = useArticleList(knowledgeBaseId)
  const [justLinked, setJustLinked] = useState<Set<string>>(new Set())
  const forbiddenIds = useMemo(() => {
    const set = new Set(justLinked)
    for (const a of currentArticles) set.add(a.id)
    return set
  }, [currentArticles, justLinked])

  const link = api.kb.linkArticles.useMutation({
    onSuccess: () => {
      void utils.kb.getArticles.invalidate({ knowledgeBaseId, includeUnpublished: true })
      void utils.knowledgeSource.listLinks.invalidate()
    },
    onError: (e) => toastError({ title: 'Could not link article', description: e.message }),
  })

  const handlePick = (articleId: string) => {
    setJustLinked((prev) => new Set(prev).add(articleId))
    link.mutate({ knowledgeBaseId, articleIds: [articleId], targetParentArticleId })
  }

  return (
    <ArticlePicker
      knowledgeBasesOverride={knowledgeBasesOverride}
      allowedKinds={['page']}
      drillableKinds={['tab', 'category']}
      forbiddenIds={forbiddenIds}
      flattenSearch
      autoFocusSearch
      rootLabel='Link an article'
      searchPlaceholder='Search knowledge bases…'
      onPick={handlePick}
      onClose={onClose}
    />
  )
}
