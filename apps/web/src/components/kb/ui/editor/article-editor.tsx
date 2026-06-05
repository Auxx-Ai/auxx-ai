// apps/web/src/components/kb/ui/editor/article-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useHotkey } from '@tanstack/react-hotkeys'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Lock } from 'lucide-react'
import { useCallback, useRef } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { KBArticleEditor } from '~/components/editor/kb-article'
import { KopilotContext } from '~/components/kopilot/context/kopilot-context'
import { KopilotSuggestion } from '~/components/kopilot/suggestions'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useDiffParam } from '../../hooks/use-diff-param'
import { useKbArticleChannel } from '../../hooks/use-kb-article-channel'
import { useKopilotReview } from '../../hooks/use-kopilot-review'
import { type ArticleMeta, getArticleStoreState } from '../../store/article-store'
import { ArticleEditorFooter } from './article-editor-footer'
import { ArticleEditorHeader } from './article-editor-header'
import { ArticleEditorTop } from './article-editor-top'

const emptyContent: JSONContent[] = [{ type: 'block', attrs: { blockType: 'text' }, content: [] }]

interface ArticleEditorProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

export function ArticleEditor({ article, knowledgeBaseId }: ArticleEditorProps) {
  const {
    draftContentJson,
    isLoading: isContentLoading,
    managed,
    sourceName,
  } = useArticleContent(article.id, knowledgeBaseId)
  const { updateArticleDraft, updateArticleContent } = useArticleMutations(knowledgeBaseId)
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const detachArticle = api.knowledgeSource.detachArticle.useMutation()
  // Cross-tab sync + Kopilot lock signal. Self-originated resyncs are
  // dropped server-side by session id; cross-tab edits invalidate the
  // article-content query and the editor's `useExternalContentSync` hook
  // picks up the new doc. The `locked` flag flips while Kopilot holds a
  // write turn so the editor goes read-only.
  const { locked } = useKbArticleChannel({ articleId: article.id, knowledgeBaseId })

  // Post-turn review: after Kopilot edits, offer Review / Keep / Undo until the
  // user commits or rolls back.
  const [, setDiff] = useDiffParam()
  const review = useKopilotReview({ articleId: article.id, draftContentJson, locked })

  const bodyEditorRef = useRef<Editor | null>(null)

  const focusBodyEditor = useCallback(() => {
    bodyEditorRef.current?.commands.focus('start')
  }, [])

  const handleBodyEditorReady = useCallback((editor: Editor) => {
    bodyEditorRef.current = editor
  }, [])

  const persist = useCallback(
    async (payload: { json: JSONContent; getHTML: () => string }) => {
      const body = (payload.json.content ?? []) as JSONContent[]
      await updateArticleContent(article.id, {
        content: payload.getHTML(),
        contentJson: body,
      })
    },
    [article.id, updateArticleContent]
  )

  const debouncedPersist = useDebounceCallback(persist, 1500)

  useHotkey('Mod+S', () => {
    toastSuccess({ title: 'Auto-saved', description: 'Your changes are saved automatically.' })
  })

  const handleMetadataUpdate = async (changes: { title?: string; description?: string }) => {
    await updateArticleDraft(article.id, changes)
  }

  // Managed (source-owned) articles are read-only until detached. Detach is
  // article-wide in Phase 1: flips `managed=false` so future syncs skip it.
  const handleDetach = async () => {
    const ok = await confirm({
      title: 'Edit this article?',
      description: sourceName
        ? `This article is synced from "${sourceName}". Editing detaches it — future syncs won't overwrite your changes.`
        : "This article is synced from a knowledge source. Editing detaches it — future syncs won't overwrite your changes.",
      confirmText: 'Edit & detach',
      cancelText: 'Cancel',
    })
    if (!ok) return
    try {
      await detachArticle.mutateAsync({ articleId: article.id })
      // Unlock the editor (re-reads managed=false) + clear the sidebar glyph.
      getArticleStoreState().applyArticleMetadataFromServer(article.id, { managed: false })
      await utils.kb.getArticleById.invalidate({ id: article.id, knowledgeBaseId })
    } catch (error) {
      toastError({
        title: "Couldn't detach article",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    }
  }

  const bodyReadOnly = locked || managed

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
      {managed && (
        <div className='flex items-center gap-3 border-b bg-amber-500/10 px-7 py-2 text-sm'>
          <Lock className='size-4 shrink-0 text-amber-700 dark:text-amber-300' />
          <span className='text-foreground'>
            Managed by {sourceName ? <span className='font-medium'>{sourceName}</span> : 'a source'}
            <span className='ml-1 text-muted-foreground'>— this article is read-only.</span>
          </span>
          <Button
            variant='outline'
            size='xs'
            className='ml-auto'
            loading={detachArticle.isPending}
            onClick={handleDetach}>
            Edit / detach
          </Button>
        </div>
      )}
      {review.pending && (
        <div className='flex items-center gap-3 border-b bg-primary-150 px-7 py-2 text-sm'>
          <span className='text-foreground'>
            Kopilot changed {review.changeCount} {review.changeCount === 1 ? 'block' : 'blocks'}.
          </span>
          <div className='ml-auto flex items-center gap-2'>
            <Button variant='outline' size='xs' onClick={() => setDiff('kopilot')}>
              Review
            </Button>
            <Button variant='outline' size='xs' loading={review.isBusy} onClick={review.onKeep}>
              Keep
            </Button>
            <Button variant='outline' size='xs' loading={review.isBusy} onClick={review.onUndo}>
              Undo
            </Button>
          </div>
        </div>
      )}
      <ScrollArea className='flex-1'>
        <div className='flex min-h-min flex-1 flex-col'>
          <div className='relative mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-7'>
            <div className='flex min-h-0 flex-1 flex-col pb-10'>
              <ArticleEditorTop
                article={article}
                knowledgeBaseId={knowledgeBaseId}
                onUpdateMetadata={handleMetadataUpdate}
                onAdvanceToContent={focusBodyEditor}
                readOnly={managed}
              />
              <div className='relative flex min-h-0 min-w-0 flex-1 flex-col items-stretch'>
                {!isContentLoading && (
                  <KBArticleEditor
                    initialContent={draftContentJson ?? emptyContent}
                    onChange={debouncedPersist}
                    knowledgeBaseId={knowledgeBaseId}
                    onReady={handleBodyEditorReady}
                    readOnly={bodyReadOnly}
                    hideGutter={managed}
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
      <ConfirmDialog />
    </div>
  )
}
