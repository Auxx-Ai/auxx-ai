// apps/web/src/components/kb/ui/editor/article-editor-top.tsx
'use client'

import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Smile } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EditableText } from '~/components/editor/editable-text'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'

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
  const { updateArticleDraft } = useArticleMutations(knowledgeBaseId)
  // article.emoji on the store mirrors the *published* revision for published
  // articles. The editor edits the draft, so source the icon from the draft
  // revision via getArticleById instead — falls back to article.emoji while
  // the query loads.
  const { draftEmoji } = useArticleContent(article.id, knowledgeBaseId)
  const effectiveEmoji = draftEmoji ?? article.emoji

  const [pickedEmoji, setPickedEmoji] = useState<string | null>(effectiveEmoji)
  useEffect(() => {
    setPickedEmoji(effectiveEmoji)
  }, [article.id, effectiveEmoji])

  const handleEmojiChange = (emoji: string) => {
    setPickedEmoji(emoji)
    void updateArticleDraft(article.id, { emoji })
  }

  return (
    <div className='page-block-openapi:ml-0 relative mx-auto flex w-full max-w-(--block-wrapper-max-width)'>
      <div className='flex flex-1'>
        <div className='flex flex-1'>
          <div className='relative mb-6 flex flex-1 flex-col pt-8'>
            <div className='flex items-start justify-between'>
              <div className='flex h-full flex-1 items-center self-stretch'>
                <div className=' flex shrink-0 items-center'>
                  <IconPicker
                    value={pickedEmoji ? { icon: pickedEmoji, color: 'gray' } : undefined}
                    onChange={(v) => handleEmojiChange(v.icon)}
                    hideColors>
                    <div>
                      {pickedEmoji ? (
                        <EntityIcon
                          iconId={pickedEmoji}
                          variant='full'
                          color='gray'
                          size='xl'
                          className='[&_svg]:size-6!'
                        />
                      ) : (
                        <Smile className='size-6!' />
                      )}
                    </div>
                  </IconPicker>
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
    </div>
  )
}
