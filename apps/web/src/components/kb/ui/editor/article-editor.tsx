// apps/web/src/components/kb/ui/editor/article-editor.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useRef } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { KBArticleEditor } from '~/components/editor/kb-article'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleEditorFooter } from './article-editor-footer'
import { ArticleEditorHeader } from './article-editor-header'
import { ArticleEditorTop } from './article-editor-top'

const emptyContent: JSONContent = {
  type: 'doc',
  content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
}

interface ArticleEditorProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

export function ArticleEditor({ article, knowledgeBaseId }: ArticleEditorProps) {
  const { draftContentJson, isLoading: isContentLoading } = useArticleContent(
    article.id,
    knowledgeBaseId
  )
  const { updateArticleDraft, updateArticleContent } = useArticleMutations(knowledgeBaseId)

  const lastSavedHash = useRef<string | null>(null)

  // Seed the saved hash on first content load so we don't immediately re-save.
  useEffect(() => {
    if (lastSavedHash.current === null && draftContentJson != null) {
      lastSavedHash.current = JSON.stringify(draftContentJson)
    }
  }, [draftContentJson])

  const persist = useCallback(
    async (payload: { json: JSONContent; html: string }) => {
      const hash = JSON.stringify(payload.json)
      if (hash === lastSavedHash.current) return
      lastSavedHash.current = hash
      await updateArticleContent(article.id, {
        content: payload.html,
        contentJson: payload.json,
      })
    },
    [article.id, updateArticleContent]
  )

  const debouncedPersist = useDebounceCallback(persist, 1500)

  const handleMetadataUpdate = async (changes: { title?: string; description?: string }) => {
    await updateArticleDraft(article.id, changes)
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ArticleEditorHeader article={article} knowledgeBaseId={knowledgeBaseId} />
      <ScrollArea className='flex-1'>
        <div className='flex min-h-min flex-1 flex-col'>
          <div className='relative mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-7'>
            <div className='flex min-h-0 flex-1 flex-col pb-10'>
              <ArticleEditorTop
                article={article}
                knowledgeBaseId={knowledgeBaseId}
                onUpdateMetadata={handleMetadataUpdate}
              />
              <div className='relative flex min-h-0 min-w-0 flex-1 flex-col items-stretch'>
                {!isContentLoading && (
                  <KBArticleEditor
                    initialContent={draftContentJson ?? emptyContent}
                    onChange={debouncedPersist}
                  />
                )}
              </div>
              <ArticleEditorFooter article={article} knowledgeBaseId={knowledgeBaseId} />
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
