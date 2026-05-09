// apps/web/src/components/kb/ui/editor/article-cover-strip.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { ImagePlus, Tags } from 'lucide-react'
import { useRef, useState } from 'react'
import { useFileSelect } from '~/components/file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { useResource } from '~/components/resources/hooks'
import { RecordTagChip } from '~/components/tags/ui/record-tag-chip'
import { TagPicker } from '~/components/tags/ui/tag-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleContent } from '../../hooks/use-article-content'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useArticleTags } from '../../hooks/use-article-tags'
import type { ArticleMeta } from '../../store/article-store'

interface ArticleCoverStripProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

const HIDDEN_KINDS = new Set(['link', 'tab', 'header'])

export function ArticleCoverStrip({ article, knowledgeBaseId }: ArticleCoverStripProps) {
  const { updateArticleCover } = useArticleMutations(knowledgeBaseId)
  const { draftCoverImage } = useArticleContent(article.id, knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()

  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsButtonRef = useRef<HTMLButtonElement>(null)
  const { selectedTags, handleTagChange } = useArticleTags(article.id)
  const { resource: tagResource } = useResource('tag')
  const tagEntityDefId = tagResource?.entityDefinitionId

  const coverImage = draftCoverImage ?? article.coverImage

  const fileSelect = useFileSelect({
    entityType: 'ARTICLE',
    entityId: article.id,
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
    sessionMetadata: {
      role: 'ARTICLE_COVER',
      knowledgeBaseId,
      articleId: article.id,
      title: `article-cover-${article.id}`,
    },
    onChange: (files) => {
      console.log('[cover] onChange', files)
    },
    onExistingFilesAdded: (files) => {
      console.log('[cover] onExistingFilesAdded', files)
      const f = files?.[0]
      console.log('[cover] existing file:', {
        url: f?.url,
        serverFileId: f?.serverFileId,
        id: f?.id,
      })
      if (!f?.url) return
      void updateArticleCover(article.id, {
        coverImage: f.url,
        coverImageId: f.serverFileId ?? f.id ?? null,
      })
    },
    onUploadComplete: (files) => {
      console.log('[cover] onUploadComplete', files)
      const f = files?.[0]
      console.log('[cover] uploaded file:', {
        url: f?.url,
        serverFileId: f?.serverFileId,
        id: f?.id,
      })
      if (!f?.url) {
        console.warn('[cover] upload completed but no url on file')
        return
      }
      console.log('[cover] persisting cover', {
        articleId: article.id,
        coverImage: f.url,
        coverImageId: f.serverFileId ?? null,
      })
      void updateArticleCover(article.id, {
        coverImage: f.url,
        coverImageId: f.serverFileId ?? null,
      })
    },
    onError: (error) => {
      console.error('[cover] onError', error)
      toastError({ title: 'Failed to upload cover', description: error })
    },
  })

  if (HIDDEN_KINDS.has(article.articleKind)) return null

  const handleRemove = async () => {
    const ok = await confirm({
      title: 'Remove cover?',
      description: 'The article will no longer have a cover image.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
    })
    if (!ok) return
    void updateArticleCover(article.id, { coverImage: null, coverImageId: null })
  }

  const tagChips = selectedTags.length > 0 && (
    <div className='flex flex-row flex-wrap items-center gap-1.5'>
      {selectedTags.map((tagId) => (
        <RecordTagChip
          key={tagId}
          tagId={tagId}
          removeLabel='article'
          onRemove={() => handleTagChange(selectedTags.filter((id) => id !== tagId))}
        />
      ))}
    </div>
  )

  const tagsButton = (
    <Button
      ref={tagsButtonRef}
      type='button'
      variant='ghost'
      size='sm'
      className='gap-1.5 text-muted-foreground hover:text-foreground'
      onClick={() => setTagsOpen(true)}>
      <Tags />
      {selectedTags.length === 0 ? 'Add tags' : 'Tags'}
    </Button>
  )

  const tagPicker = tagsOpen && (
    <TagPicker
      open={tagsOpen}
      onOpenChange={setTagsOpen}
      anchorRef={tagsButtonRef}
      selectedTags={selectedTags}
      onChange={(next) => handleTagChange(next as typeof selectedTags)}
      tagEntityDefinitionId={tagEntityDefId}
      scope='article'
      allowMultiple
    />
  )

  if (!coverImage) {
    return (
      <>
        <div className='page-block-openapi:ml-0 mx-auto flex w-full max-w-(--block-wrapper-max-width) flex-wrap items-center gap-2 pt-4'>
          <FileSelectPicker fileSelect={fileSelect}>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='gap-1.5 text-muted-foreground hover:text-foreground'>
              <ImagePlus />
              Add cover
            </Button>
          </FileSelectPicker>
          {tagsButton}
          {tagChips}
        </div>
        {tagPicker}
        {ConfirmDialog}
      </>
    )
  }

  return (
    <>
      <div className='page-block-openapi:ml-0 group relative mx-auto w-full max-w-(--block-wrapper-max-width) pt-4'>
        <img src={coverImage} alt='' className='aspect-[1200/630] w-full rounded-md object-cover' />
        <div className='absolute right-2 bottom-2 flex flex-wrap items-center gap-1.5 rounded-md bg-background/80 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
          <FileSelectPicker fileSelect={fileSelect}>
            <Button type='button' variant='ghost' size='sm'>
              Replace
            </Button>
          </FileSelectPicker>
          <Button type='button' variant='ghost' size='sm' onClick={handleRemove}>
            Remove
          </Button>
          {tagsButton}
          {tagChips}
        </div>
      </div>
      {tagPicker}
      <ConfirmDialog />
    </>
  )
}
