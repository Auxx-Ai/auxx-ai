// apps/web/src/components/kb/ui/editor/article-editor.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useCallback, useRef } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { KBArticleEditor } from '~/components/editor/kb-article'
import { KopilotContext } from '~/components/kopilot/context/kopilot-context'
import { KopilotSuggestion } from '~/components/kopilot/suggestions'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useKbArticleChannel } from '../../hooks/use-kb-article-channel'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleEditorFooter } from './article-editor-footer'
import { ArticleEditorHeader } from './article-editor-header'
import { ArticleEditorTop } from './article-editor-top'

const emptyContent: JSONContent[] = [{ type: 'block', attrs: { blockType: 'text' }, content: [] }]

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
  // Cross-tab sync + Kopilot lock signal. Self-originated resyncs are
  // dropped server-side by session id; cross-tab edits invalidate the
  // article-content query and the editor's `useExternalContentSync` hook
  // picks up the new doc. The `locked` flag flips while Kopilot holds a
  // write turn so the editor goes read-only.
  const { locked } = useKbArticleChannel({ articleId: article.id, knowledgeBaseId })

  const bodyEditorRef = useRef<Editor | null>(null)

  const focusBodyEditor = useCallback(() => {
    bodyEditorRef.current?.commands.focus('start')
  }, [])

  const handleBodyEditorReady = useCallback((editor: Editor) => {
    bodyEditorRef.current = editor
  }, [])

  const persist = useCallback(
    async (payload: { json: JSONContent; html: string }) => {
      const body = (payload.json.content ?? []) as JSONContent[]
      await updateArticleContent(article.id, {
        content: payload.html,
        contentJson: body,
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
      <KopilotContext
        activeArticleId={article.id}
        activeArticleLabel={article.title ?? undefined}
      />
      <KopilotSuggestion text='Outline this article' icon='pencil' priority={10} />
      <KopilotSuggestion text='Suggest related articles' icon='list' autoSubmit />
      <KopilotSuggestion text='Improve this article' icon='sparkle' />
      <ArticleEditorHeader article={article} knowledgeBaseId={knowledgeBaseId} />
      <ScrollArea className='flex-1'>
        <div className='flex min-h-min flex-1 flex-col'>
          <div className='relative mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-7'>
            <div className='flex min-h-0 flex-1 flex-col pb-10'>
              <ArticleEditorTop
                article={article}
                knowledgeBaseId={knowledgeBaseId}
                onUpdateMetadata={handleMetadataUpdate}
                onAdvanceToContent={focusBodyEditor}
              />
              <div className='relative flex min-h-0 min-w-0 flex-1 flex-col items-stretch'>
                {!isContentLoading && (
                  <KBArticleEditor
                    initialContent={draftContentJson ?? emptyContent}
                    onChange={debouncedPersist}
                    knowledgeBaseId={knowledgeBaseId}
                    onReady={handleBodyEditorReady}
                    readOnly={locked}
                  />
                )}
                {locked && (
                  <div className='pointer-events-none absolute top-2 right-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-amber-700 text-xs dark:text-amber-300'>
                    Kopilot is editing — your changes are paused
                  </div>
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
