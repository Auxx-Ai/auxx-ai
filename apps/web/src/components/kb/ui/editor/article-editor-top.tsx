// apps/web/src/components/kb/ui/editor/article-editor-top.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EmojiPicker } from '@auxx/ui/components/emoji-picker'
import { Cog, Smile } from 'lucide-react'
import { useState } from 'react'
import { EditableText } from '~/components/editor/editable-text'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleRenameDialog } from './article-rename-dialog'

interface ArticleEditorTopProps {
  article: ArticleMeta
  knowledgeBaseId: string
  onUpdateMetadata?: (changes: { title?: string; description?: string }) => void
}

export function ArticleEditorTop({
  article,
  knowledgeBaseId,
  onUpdateMetadata,
}: ArticleEditorTopProps) {
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const { updateArticle, renameArticle } = useArticleMutations(knowledgeBaseId)

  const handleEmojiChange = (emoji: string) => {
    void updateArticle(article.id, { emoji })
  }

  const handleRenameSubmit = async (values: {
    title: string
    emoji: string | null
    slug?: string
  }) => {
    await renameArticle(article.id, {
      title: values.title,
      emoji: values.emoji,
      slug: values.slug,
    })
  }

  return (
    <div className='page-block-openapi:ml-0 relative mx-auto flex w-full max-w-(--block-wrapper-max-width)'>
      <div className='flex flex-1'>
        <div className='flex flex-1'>
          <div className='group/page-header relative mb-6 flex flex-1 flex-col pt-8'>
            <div className='absolute top-0 my-2 flex gap-x-1 opacity-0 transition group-hover/page-header:opacity-100'>
              <Button variant='outline' size='xs' onClick={() => setIsRenameDialogOpen(true)}>
                <Cog /> Page settings
              </Button>
            </div>
            <div className='flex items-start justify-between'>
              <div className='flex h-full flex-1 self-stretch'>
                <div className='flex h-10 w-auto shrink-0 flex-row items-center justify-end lg:h-12'>
                  <div className='relative flex pl-0 pr-2 lg:absolute lg:pl-4 lg:pr-2'>
                    <EmojiPicker value={article.emoji ?? undefined} onChange={handleEmojiChange}>
                      <Button variant='ghost' size='icon' className='rounded-full'>
                        {article.emoji ? (
                          <span className='text-2xl leading-none'>{article.emoji}</span>
                        ) : (
                          <Smile size={26} />
                        )}
                      </Button>
                    </EmojiPicker>
                  </div>
                </div>
                <div className='relative flex h-full w-full items-center overflow-hidden text-2xl font-semibold lg:text-4xl'>
                  <EditableText
                    className='leading-snug focus:ring-0'
                    containerClassName='w-full'
                    initialText={article.title}
                    placeholderColor='text-muted-foreground'
                    placeholder='Title goes here'
                    onSave={(newTitle) => {
                      if (onUpdateMetadata && newTitle !== article.title) {
                        onUpdateMetadata({ title: newTitle })
                      }
                    }}
                  />
                </div>
              </div>
              <div className='mt-1.5'>
                {/* <Button variant='ghost' size='icon' className='rounded-full'>
                  <MoreVertical />
                </Button> */}
              </div>
            </div>
            <div className='flex items-center justify-between'>
              <div className='flex flex-1 items-center justify-start'>
                <div className='mt-2 max-h-[2.5rem] flex-1 overflow-y-scroll text-muted-foreground'>
                  <EditableText
                    placeholder='Add a description...'
                    placeholderColor='text-muted-foreground'
                    className='leading-snug focus:ring-0'
                    initialText={article.description || ''}
                    onSave={(newDescription) => {
                      if (onUpdateMetadata && newDescription !== article.description) {
                        onUpdateMetadata({ description: newDescription })
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ArticleRenameDialog
        open={isRenameDialogOpen}
        onOpenChange={setIsRenameDialogOpen}
        article={article}
        onSubmit={handleRenameSubmit}
      />
    </div>
  )
}
