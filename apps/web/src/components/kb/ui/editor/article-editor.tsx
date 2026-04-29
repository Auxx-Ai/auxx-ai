// apps/web/src/components/kb/ui/editor/article-editor.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import type { JSONContent } from '@tiptap/core'
import { PanelLeftClose } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import AuxxEditor from '~/components/editor/auxx-editor'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleEditorFooter } from './article-editor-footer'
import { ArticleEditorTop } from './article-editor-top'

const emptyContent: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }

interface ArticleEditorProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

export function ArticleEditor({ article, knowledgeBaseId }: ArticleEditorProps) {
  const [isSaving, setIsSaving] = useState(false)
  const saveInProgressRef = useRef(false)
  const lastSavedContentHash = useRef<string | null>(null)

  const { contentJson, isLoading: isContentLoading } = useArticleContent(
    article.id,
    knowledgeBaseId
  )
  const { updateArticle, updateArticleContent } = useArticleMutations(knowledgeBaseId)

  // Track the last saved JSON to skip no-op saves.
  useEffect(() => {
    if (lastSavedContentHash.current === null) {
      const initial = contentJson ?? emptyContent
      lastSavedContentHash.current = JSON.stringify(initial)
    }
  }, [contentJson])

  const handleContentChange = async (editorContent: {
    json: JSONContent
    html: string
    markdown: string
  }) => {
    if (saveInProgressRef.current) return

    const hash = JSON.stringify(editorContent.json)
    if (hash === lastSavedContentHash.current) return
    lastSavedContentHash.current = hash

    setIsSaving(true)
    saveInProgressRef.current = true
    try {
      await updateArticleContent(article.id, {
        content: editorContent.html,
        contentJson: editorContent.json,
      })
    } finally {
      setIsSaving(false)
      saveInProgressRef.current = false
    }
  }

  const handleManualSave = async () => {
    if (saveInProgressRef.current) return
    setIsSaving(true)
    saveInProgressRef.current = true
    try {
      // No new content to send — re-save the current contentJson.
      await updateArticleContent(article.id, { contentJson: contentJson ?? emptyContent })
    } finally {
      setIsSaving(false)
      saveInProgressRef.current = false
    }
  }

  // Title/description edits go through the metadata-optimistic path.
  const handleMetadataUpdate = async (changes: { title?: string; description?: string }) => {
    await updateArticle(article.id, changes)
  }

  return (
    <div
      className='flex flex-1'
      style={
        {
          '--page-wrapper-max-width': '1200px',
          '--page-wrapper-padding-x': '1.75rem',
          '--toc-hover-area-width': '48px',
          '--block-wrapper-max-width': '760px',
        } as React.CSSProperties
      }>
      <div className='flex flex-1 flex-col overflow-y-auto'>
        <div className='flex min-h-min flex-1 flex-col'>
          <div className='flex flex-1'>
            <div className='flex h-full flex-1'>
              <div className='z-100 sticky top-0 flex h-fit w-10 justify-center pt-2 max-lg:hidden'>
                <Button variant='ghost' className='rounded-full opacity-0 hover:opacity-100'>
                  <PanelLeftClose className='h-10 w-10' />
                </Button>
              </div>
              <div className='relative mx-auto flex h-full w-full max-w-(--page-wrapper-max-width) flex-1 flex-col px-[28px]'>
                <div className='flex flex-1 flex-col justify-between pb-10'>
                  <div>
                    <ArticleEditorTop article={article} onUpdateMetadata={handleMetadataUpdate} />
                    <div className='relative min-h-0 min-w-0 flex-col items-stretch'>
                      {!isContentLoading && (
                        <AuxxEditor
                          initialContent={contentJson ?? emptyContent}
                          onContentChange={handleContentChange}
                          isSaving={isSaving}
                          autoSave={true}
                          debounceMs={3000}
                        />
                      )}
                    </div>
                  </div>

                  <ArticleEditorFooter
                    article={article}
                    knowledgeBaseId={knowledgeBaseId}
                    isSaving={isSaving}
                    onSave={handleManualSave}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
