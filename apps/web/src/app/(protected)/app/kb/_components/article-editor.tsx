// components/knowledge-base/article-editor.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import AuxxEditor from '~/components/editor/auxx-editor'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { JSONContent } from '@tiptap/core'
import { PanelLeftClose } from 'lucide-react'
import ArticleEditorFooter from './article-editor-footer'
import ArticleEditorTop from './article-editor-top'
import type { Article } from './kb-context'

// Extended article type with all properties needed for the editor
interface ArticleWithContent extends Omit<Article, 'content' | 'description'> {
  content?: string | null
  contentJson?: JSONContent | null
  description?: string | null
  excerpt?: string | null
}

// Define the structure for article data
interface ArticleData {
  title: string
  description: string
  slug: string
  content: string
  contentJson: JSONContent
  isPublished: boolean
  emoji: string
  excerpt: string
}

// Empty content structure for the editor when no content exists
const emptyContent: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [] }] }

interface ArticleEditorProps {
  article: ArticleWithContent
  knowledgeBaseId: string
}

export default function ArticleEditor({ article, knowledgeBaseId }: ArticleEditorProps) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [saveInProgress, setSaveInProgress] = useState(false)
  const lastSavedContentHash = useRef<string | null>(null)

  // Store article data directly in state instead of using react-hook-form
  const [articleData, setArticleData] = useState<ArticleData>({
    title: article.title,
    description: article.description || '',
    slug: article.slug,
    content: article.content || '',
    contentJson: article.contentJson || emptyContent,
    isPublished: article.isPublished,
    emoji: article.emoji || '',
    excerpt: article.excerpt || '',
  })

  // Initialize lastSavedContentHash with the current article content
  useEffect(() => {
    if (lastSavedContentHash.current === null) {
      // Use the contentJson if it exists, otherwise use emptyContent
      const initialContent = articleData.contentJson || emptyContent
      lastSavedContentHash.current = JSON.stringify(initialContent)
    }
  }, [articleData.contentJson])

  // Update article mutation
  const updateArticle = api.kb.updateArticle.useMutation({
    onSuccess: () => {
      setIsSaving(false)
      setSaveInProgress(false)
      // Removed toast as requested - silent saving
      // router.refresh() - removed to prevent unnecessary refreshes during typing
    },
    onError: (error) => {
      setIsSaving(false)
      setSaveInProgress(false)
      toastError({ title: 'Failed to save article', description: error.message })
      console.error('Failed to update article:', error)
    },
  })

  // Handle content change from the editor - this will be called only after debouncing
  const handleContentChange = async (editorContent: {
    json: JSONContent
    html: string
    markdown: string
  }) => {
    // Avoid multiple concurrent save operations
    if (saveInProgress) {
      return
    }

    // Create a hash of the content to compare with last saved content
    const contentHash = JSON.stringify(editorContent.json)

    // Don't save if content hasn't changed from last save
    if (contentHash === lastSavedContentHash.current) {
      return
    }

    // Update the last saved content hash
    lastSavedContentHash.current = contentHash

    setIsSaving(true)
    setSaveInProgress(true)

    // Update article data with new content
    const updatedArticleData = {
      ...articleData,
      content: editorContent.html,
      contentJson: editorContent.json,
    }

    // Update local state
    setArticleData(updatedArticleData)

    try {
      // Save the article with updated content
      await updateArticle.mutateAsync({ id: article.id, data: updatedArticleData, knowledgeBaseId })
    } catch (error) {
      // Error handling is done in the mutation onError callback
      console.error('Error in handleContentChange:', error)
    }
  }

  // Manual save handler
  const handleManualSave = async () => {
    // Avoid multiple concurrent save operations
    if (saveInProgress) {
      return
    }

    setIsSaving(true)
    setSaveInProgress(true)

    try {
      await updateArticle.mutateAsync({ id: article.id, data: articleData, knowledgeBaseId })

      // Update the last saved content hash after manual save
      if (articleData.contentJson) {
        lastSavedContentHash.current = JSON.stringify(articleData.contentJson)
      }
    } catch (error) {
      // Error handling is done in the mutation onError callback
      console.error('Error in manual save:', error)
    }
  }

  // Handle title and description updates
  const handleMetadataUpdate = async (changes: { title?: string; description?: string }) => {
    // Avoid multiple concurrent save operations
    if (saveInProgress) {
      return
    }

    setIsSaving(true)
    setSaveInProgress(true)

    // Update article data with new metadata
    const updatedArticleData = { ...articleData, ...changes }

    // Update local state
    setArticleData(updatedArticleData)

    try {
      // Save the article with updated metadata
      await updateArticle.mutateAsync({ id: article.id, data: updatedArticleData, knowledgeBaseId })
    } catch (error) {
      // Error handling is done in the mutation onError callback
      console.error('Error in metadata update:', error)
    }
  }

  return (
    <div
      className="flex flex-1"
      style={
        {
          '--page-wrapper-max-width': '1200px',
          '--page-wrapper-padding-x': '1.75rem',
          '--toc-hover-area-width': '48px',
          '--block-wrapper-max-width': '760px',
        } as React.CSSProperties
      }>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-min flex-1 flex-col">
          <div className="flex flex-1">
            <div className="flex h-full flex-1">
              <div className="z-100 sticky top-0 flex h-fit w-10 justify-center pt-2 max-lg:hidden">
                <Button variant={'ghost'} className="rounded-full opacity-0 hover:opacity-100">
                  <PanelLeftClose className="h-10 w-10" />
                </Button>
              </div>
              <div className="relative mx-auto flex h-full w-full max-w-(--page-wrapper-max-width) flex-1 flex-col px-[28px]">
                <div className="flex flex-1 flex-col justify-between pb-10">
                  <div>
                    <ArticleEditorTop article={article} onUpdateMetadata={handleMetadataUpdate} />
                    <div className="relative min-h-0 min-w-0 flex-col items-stretch">
                      <AuxxEditor
                        initialContent={articleData.contentJson}
                        onContentChange={handleContentChange}
                        isSaving={isSaving}
                        autoSave={true}
                        debounceMs={3000} // Set a higher debounce time (3 seconds)
                      />
                    </div>
                  </div>

                  {/* Bottom */}
                  <ArticleEditorFooter
                    article={article}
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
