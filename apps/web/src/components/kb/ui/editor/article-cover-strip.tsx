// apps/web/src/components/kb/ui/editor/article-cover-strip.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { ImagePlus, Tags } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFileSelect } from '~/components/file-select'
import { FileSelectPicker } from '~/components/pickers/file-select-picker'
import { useResource } from '~/components/resources/hooks'
import { RecordTagChip } from '~/components/tags/ui/record-tag-chip'
import { TagBadge } from '~/components/tags/ui/tag-badge'
import { TagPicker } from '~/components/tags/ui/tag-picker'
import { useConfirm } from '~/hooks/use-confirm'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import { useArticleTags } from '../../hooks/use-article-tags'
import type { ArticleMeta } from '../../store/article-store'
import { useKBEditorAccess } from './kb-editor-access-context'

interface ArticleCoverStripProps {
  article: ArticleMeta
  knowledgeBaseId: string
}

const HIDDEN_KINDS = new Set(['link', 'tab', 'header'])

export function ArticleCoverStrip({ article, knowledgeBaseId }: ArticleCoverStripProps) {
  // Cover + tags are both article writes (`kb.updateArticleDraft` /
  // the tag mutations), so a view-level member gets the read-only strip: the
  // cover renders without Replace/Remove, tags render as plain badges, and the
  // "Add cover"/"Add tags" entry points disappear entirely.
  const { canEdit } = useKBEditorAccess()
  const { updateArticleCover } = useArticleMutations(knowledgeBaseId)
  const [confirm, ConfirmDialog] = useConfirm()
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsButtonRef = useRef<HTMLButtonElement>(null)
  const { selectedTags, handleTagChange } = useArticleTags(article.id)
  const { resource: tagResource } = useResource('tag')
  const tagEntityDefId = tagResource?.entityDefinitionId

  // The store's `draft.coverImage` is the freshly resolved URL for the
  // article's draft cover — read it synchronously so there's no async
  // flash between the editor-row and cover-row states.
  const coverImage = article.draft.coverImage

  const fileSelect = useFileSelect({
    entityType: 'ARTICLE',
    entityId: article.id,
    allowMultiple: false,
    maxFiles: 1,
    autoStart: true,
    fileExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
    sessionMetadata: {
      role: 'COVER',
      knowledgeBaseId,
      articleId: article.id,
      title: `article-cover-${article.id}`,
    },
    onUploadComplete: (files) => {
      const f = files?.[0]
      if (!f?.serverFileId) return
      void updateArticleCover(article.id, { coverImageId: f.serverFileId })
    },
    onError: (error) => {
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
    void updateArticleCover(article.id, { coverImageId: null })
  }

  const tagChips = selectedTags.length > 0 && (
    <div className='flex flex-row flex-wrap items-center gap-1.5'>
      {selectedTags.map((tagId) =>
        canEdit ? (
          <RecordTagChip
            key={tagId}
            tagId={tagId}
            removeLabel='article'
            onRemove={() => handleTagChange(selectedTags.filter((id) => id !== tagId))}
          />
        ) : (
          // Plain badge, not the chip — the chip's dropdown offers remove/edit/
          // delete-tag, all of which are writes.
          <TagBadge key={tagId} recordId={tagId} size='sm' />
        )
      )}
    </div>
  )

  const tagsButton = canEdit && (
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

  const tagPicker = tagsOpen && canEdit && (
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
    // Nothing to add, nothing to show — skip the row entirely rather than
    // leaving an empty band of padding above the title.
    if (!canEdit && !tagChips) return null
    return (
      <>
        <div className='page-block-openapi:ml-0 mx-auto flex w-full max-w-(--block-wrapper-max-width) flex-wrap items-center gap-2 pt-4'>
          {canEdit && (
            <FileSelectPicker fileSelect={fileSelect} hideBrowseExisting>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='gap-1.5 text-muted-foreground hover:text-foreground'>
                <ImagePlus />
                Add cover
              </Button>
            </FileSelectPicker>
          )}
          {tagsButton}
          {tagChips}
        </div>
        {tagPicker}
        <ConfirmDialog />
      </>
    )
  }

  // Read-only: the cover stands alone and any tags sit under it as plain
  // badges — the hover overlay only ever holds write affordances.
  if (!canEdit) {
    return (
      <div className='page-block-openapi:ml-0 mx-auto w-full max-w-(--block-wrapper-max-width) pt-4'>
        <CoverImage src={coverImage} />
        {tagChips && <div className='pt-2'>{tagChips}</div>}
      </div>
    )
  }

  return (
    <>
      <div className='page-block-openapi:ml-0 group relative mx-auto w-full max-w-(--block-wrapper-max-width) pt-4'>
        <CoverImage src={coverImage} />
        <div className='absolute right-2 bottom-2 flex flex-wrap items-center gap-1.5 rounded-md bg-background/80 p-1 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
          <FileSelectPicker fileSelect={fileSelect} hideBrowseExisting>
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

function CoverImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    setLoaded(false)
  }, [src])
  return (
    <div className='relative aspect-[1200/630] w-full overflow-hidden rounded-md bg-muted'>
      <img
        src={src}
        alt=''
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}
