// apps/web/src/components/kb/ui/editor/article-editor-header.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { getFullSlugPath, getKbPreviewHref } from '@auxx/ui/components/kb/utils'
import { Cog, Eye } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useArticleList } from '../../hooks/use-article-list'
import type { ArticleMeta } from '../../store/article-store'
import { ArticlePublishCluster } from './article-publish-cluster'
import { ArticleSettingsDialog } from './article-settings-dialog'
import { HiddenParentBadge } from './hidden-parent-badge'

interface ArticleEditorHeaderProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

export function ArticleEditorHeader({ article, knowledgeBaseId }: ArticleEditorHeaderProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const articles = useArticleList(knowledgeBaseId)

  const previewHref = useMemo(
    () => getKbPreviewHref(knowledgeBaseId, getFullSlugPath(article, articles)),
    [article, articles, knowledgeBaseId]
  )

  return (
    <div className='flex w-full items-center gap-2 border-b bg-primary-150 px-3 py-1.5 rounded-b-none'>
      <Button variant='outline' size='xs' onClick={() => setIsSettingsOpen(true)}>
        <Cog /> Page settings
      </Button>
      <ArticlePublishCluster article={article} knowledgeBaseId={knowledgeBaseId} />
      <HiddenParentBadge article={article} knowledgeBaseId={knowledgeBaseId} />
      <Button variant='outline' size='xs' className='ml-auto' asChild>
        <a href={previewHref} target='_blank' rel='noopener'>
          <Eye /> Preview
        </a>
      </Button>
      <ArticleSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        article={article}
        knowledgeBaseId={knowledgeBaseId}
      />
    </div>
  )
}
