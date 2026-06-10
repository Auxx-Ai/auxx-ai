// apps/web/src/components/kb/ui/editor/article-versions-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { getFullSlugPath } from '@auxx/ui/components/kb'
import { getKbPreviewHref } from '@auxx/ui/components/kb/utils'
import { toastSuccess } from '@auxx/ui/components/toast'
import { ExternalLink, GitCompare } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import {
  VersionHistoryDialog,
  type VersionRowData,
} from '~/components/versioning/ui/version-history-dialog'
import { api } from '~/trpc/react'
import { useArticleList } from '../../hooks/use-article-list'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useDiffParam } from '../../hooks/use-diff-param'

interface ArticleVersionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  articleId: string
  knowledgeBaseId: string
}

/**
 * Adapter over the shared {@link VersionHistoryDialog} passing the full surface —
 * the `title` headline, label rename (`kb.renameArticleVersion`), and per-row
 * extra actions (preview link + content diff). The richest of the three
 * consumers, so it proves the shared API is sufficient. KB restore is already
 * restore-as-draft. See plans/agents/agent-versions/ui-plan.md §3.2.
 */
export function ArticleVersionsDialog({
  open,
  onOpenChange,
  articleId,
  knowledgeBaseId,
}: ArticleVersionsDialogProps) {
  const utils = api.useUtils()
  const { restoreArticleVersion } = useArticleMutations(knowledgeBaseId)
  const [, setDiff] = useDiffParam()
  const renameMutation = api.kb.renameArticleVersion.useMutation()

  const versionsQuery = api.kb.getArticleVersions.useQuery({ articleId }, { enabled: open })
  const article = api.kb.getArticleById.useQuery(
    { id: articleId, knowledgeBaseId },
    { enabled: open }
  )

  const articles = useArticleList(knowledgeBaseId)
  const slugPath = (() => {
    const a = articles.find((x) => x.id === articleId)
    return a ? getFullSlugPath(a, articles) : ''
  })()

  const versions: VersionRowData[] | undefined = versionsQuery.data?.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    label: v.label,
    title: v.title,
    editorName: v.editor?.name ?? 'System',
    createdAt: v.createdAt,
  }))

  return (
    <VersionHistoryDialog
      open={open}
      onOpenChange={onOpenChange}
      versions={versions}
      isLoading={versionsQuery.isLoading}
      currentVersionId={article.data?.publishedRevisionId ?? null}
      emptyMessage='No published versions yet. Publish this article to create the first one.'
      onRestore={async (version) => {
        await restoreArticleVersion(version.id)
        toastSuccess({ title: 'Version loaded into draft' })
        return true
      }}
      onRenameLabel={async (versionId, label) => {
        await renameMutation.mutateAsync({ versionId, label: label?.trim() || null })
        utils.kb.getArticleVersions.invalidate({ articleId })
      }}
      renderRowActions={(v, { isCurrent }) => (
        <>
          {v.versionNumber !== null && slugPath ? (
            <Tooltip content='View this version'>
              <Button size='icon-xs' variant='ghost' asChild>
                <a
                  href={getKbPreviewHref(knowledgeBaseId, slugPath, {
                    versionNumber: v.versionNumber,
                  })}
                  target='_blank'
                  rel='noopener'>
                  <ExternalLink />
                </a>
              </Button>
            </Tooltip>
          ) : null}
          {!isCurrent && (
            <Tooltip content='Compare with current'>
              <Button
                size='icon-xs'
                variant='ghost'
                onClick={() => {
                  setDiff(`v:${v.id}`)
                  onOpenChange(false)
                }}>
                <GitCompare />
              </Button>
            </Tooltip>
          )}
        </>
      )}
    />
  )
}
