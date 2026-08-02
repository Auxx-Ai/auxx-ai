// apps/web/src/components/kb/ui/editor/article-editor-top.tsx
'use client'

import { AutosizeField } from '@auxx/ui/components/autosize-field'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { Smile } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useArticleMutations } from '../../hooks/use-article-mutations'
import type { ArticleMeta } from '../../store/article-store'
import { ArticleCoverStrip } from './article-cover-strip'

interface InlineTextFieldProps {
  /** Persisted value — resets the local draft whenever it changes. */
  value: string
  /** Called on blur/Enter with the trimmed value, only when it actually changed. */
  onCommit: (value: string) => void
  /** Called after Enter commits — used to advance focus to the next field. */
  onEnter?: () => void
  placeholder: string
  className?: string
  /** Rows to show before the field scrolls instead of growing. */
  maxRows?: number
  readOnly?: boolean
  fieldRef?: React.RefObject<HTMLTextAreaElement | null>
}

/**
 * Always-live, auto-growing single-line-semantics text field: it wraps to as
 * many lines as the content needs (up to `maxRows`) but never stores newlines —
 * Enter commits and advances rather than breaking the line.
 */
function InlineTextField({
  value,
  onCommit,
  onEnter,
  placeholder,
  className,
  maxRows,
  readOnly = false,
  fieldRef,
}: InlineTextFieldProps) {
  const [draft, setDraft] = useState(value)
  // Blur fires synchronously from the Escape/Enter handlers, before the state
  // update lands — so commit reads the draft from a ref, and dedupes against
  // the last value it actually sent.
  const draftRef = useRef(value)
  const committedRef = useRef(value)

  const updateDraft = (next: string) => {
    draftRef.current = next
    setDraft(next)
  }

  useEffect(() => {
    committedRef.current = value
    draftRef.current = value
    setDraft(value)
  }, [value])

  const commit = () => {
    const next = draftRef.current.trim()
    if (next !== draftRef.current) updateDraft(next)
    if (next === committedRef.current) return
    committedRef.current = next
    onCommit(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      onEnter?.()
      return
    }
    if (e.key === 'Escape') {
      updateDraft(value)
      e.currentTarget.blur()
    }
  }

  return (
    <AutosizeField
      ref={fieldRef}
      variant='transparent'
      minRows={1}
      maxRows={maxRows}
      value={draft}
      readOnly={readOnly}
      placeholder={readOnly ? undefined : placeholder}
      // Pasted multi-line text collapses to spaces — the field renders wrapped
      // lines, but title/description stay single-line values.
      onChange={(e) => updateDraft(e.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      className={cn(
        // `border-solid` is required: the transparent variant sets `border-none`,
        // which wins the border-style slot and would suppress the border entirely.
        // The always-present transparent border keeps the layout from shifting
        // when the hover/focus border appears.
        'rounded-2xl border border-transparent border-solid transition-colors placeholder:text-muted-foreground',
        !readOnly && 'hover:border-primary-300 focus:border-primary-400',
        readOnly && 'cursor-default',
        className
      )}
    />
  )
}

interface ArticleEditorTopProps {
  article: ArticleMeta
  knowledgeBaseId: string
  onUpdateMetadata?: (changes: { title?: string; description?: string }) => void
  onAdvanceToContent?: () => void
  /** Source-managed article — title/description/emoji are read-only. */
  readOnly?: boolean
}

export function ArticleEditorTop({
  article,
  knowledgeBaseId,
  onUpdateMetadata,
  onAdvanceToContent,
  readOnly = false,
}: ArticleEditorTopProps) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const { updateArticleDraft } = useArticleMutations(knowledgeBaseId)
  const draftEmoji = article.draft.emoji
  const hasCover = !!article.draft.coverImage

  const [pickedEmoji, setPickedEmoji] = useState<string | null>(draftEmoji)
  useEffect(() => {
    setPickedEmoji(draftEmoji)
  }, [article.id, draftEmoji])

  const handleEmojiChange = (emoji: string) => {
    setPickedEmoji(emoji)
    void updateArticleDraft(article.id, { emoji })
  }

  return (
    <>
      <ArticleCoverStrip article={article} knowledgeBaseId={knowledgeBaseId} />
      <div className='page-block-openapi:ml-0 relative mx-auto flex w-full max-w-(--block-wrapper-max-width)'>
        <div className='flex flex-1'>
          <div className='flex flex-1'>
            <div className={`relative mb-6 flex flex-1 flex-col ${hasCover ? 'pt-8' : ''}`}>
              <div className='flex items-start justify-between'>
                <div className='flex h-full flex-1 items-center self-stretch'>
                  <div className=' flex shrink-0 items-center'>
                    {readOnly ? (
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
                    ) : (
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
                    )}
                  </div>
                  <div className='relative flex h-full w-full items-center'>
                    <InlineTextField
                      readOnly={readOnly}
                      value={article.title}
                      placeholder='Title goes here'
                      className='px-2 py-0 font-semibold text-2xl leading-snug lg:text-4xl'
                      onCommit={(title) => onUpdateMetadata?.({ title })}
                      onEnter={() => descriptionRef.current?.focus()}
                    />
                  </div>
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <div className='flex flex-1 items-center justify-start'>
                  <div className='mt-2 flex-1'>
                    <InlineTextField
                      fieldRef={descriptionRef}
                      readOnly={readOnly}
                      value={article.description || ''}
                      placeholder='Add a description...'
                      maxRows={4}
                      className='px-2 py-1 text-base text-muted-foreground leading-snug'
                      onCommit={(description) => onUpdateMetadata?.({ description })}
                      onEnter={() => onAdvanceToContent?.()}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
