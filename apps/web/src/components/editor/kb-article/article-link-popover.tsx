// apps/web/src/components/editor/kb-article/article-link-popover.tsx
'use client'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Popover, PopoverAnchor, PopoverContentDialogAware } from '@auxx/ui/components/popover'
import { buildAuxxArticleUrl } from '@auxx/utils'
import { Link as LinkIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useArticleList } from '~/components/kb/hooks/use-article-list'
import { ArticlePicker } from '~/components/kb/ui/articles/article-picker'

export interface ArticleLinkPick {
  /** Insertable href — `auxx://kb/article/{id}` or a raw URL. */
  href: string
  /** Visible link text — the article title or, for raw URLs, the URL itself. */
  text: string
}

export interface ArticleLinkEditMode {
  kind: 'edit'
  initialHref: string
  initialText: string
}

interface ArticleLinkPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional initial KB to scope to — if absent, picker shows the org's KB list. */
  knowledgeBaseId?: string
  onPick: (pick: ArticleLinkPick) => void
  /**
   * Anchor element the popover positions against. Provide either `children`
   * (rendered as the trigger via PopoverAnchor) or `anchorRect` for a virtual
   * anchor (e.g. cursor position inside an editor).
   */
  children?: React.ReactNode
  anchorRect?: DOMRect | null
  /**
   * When set, renders a URL editor row above the picker (prefilled with the
   * existing link's href). Used by the right-click → Edit flow.
   */
  mode?: ArticleLinkEditMode
}

export function ArticleLinkPopover({
  open,
  onOpenChange,
  knowledgeBaseId,
  onPick,
  children,
  anchorRect,
  mode,
}: ArticleLinkPopoverProps) {
  const articles = useArticleList(knowledgeBaseId)

  const virtualRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => anchorRect ?? new DOMRect(),
  })
  // Keep the virtual anchor's rect in sync with the latest prop without
  // recreating the ref (Radix reads getBoundingClientRect lazily).
  virtualRef.current.getBoundingClientRect = () => anchorRect ?? new DOMRect()

  const anchorEl = useMemo(() => {
    if (children) return <PopoverAnchor asChild>{children}</PopoverAnchor>
    return <PopoverAnchor virtualRef={virtualRef} />
  }, [children])

  const isEdit = mode?.kind === 'edit'
  const [urlDraft, setUrlDraft] = useState(mode?.initialHref ?? '')

  // Reset the draft each time the popover opens in edit mode.
  useEffect(() => {
    if (open && isEdit) setUrlDraft(mode?.initialHref ?? '')
  }, [open, isEdit, mode?.initialHref])

  const submitUrl = () => {
    const trimmed = urlDraft.trim()
    if (!trimmed) return
    onPick({
      href: trimmed,
      text: mode?.initialText?.trim() || trimmed,
    })
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorEl}
      <PopoverContentDialogAware
        align='start'
        sideOffset={8}
        className='p-0'
        onOpenAutoFocus={(e) => {
          // Let the cmdk input inside ArticlePicker handle its own focus,
          // unless we're in edit mode where the URL input is primary.
          if (!isEdit) e.preventDefault()
        }}
        onFocusOutside={(e) => {
          // cmdk re-renders the CommandList on drill-down, which briefly
          // unmounts the focused element. Browser focus shifts to a sibling
          // input outside the popover, which Radix would otherwise treat as
          // a dismissal. Ignore focus-driven dismissals — only real pointer
          // clicks outside should close the picker.
          e.preventDefault()
        }}>
        {isEdit ? (
          <div className='border-foreground/10 border-b p-2'>
            <InputGroup>
              <InputGroupAddon align='inline-start'>
                <LinkIcon />
              </InputGroupAddon>
              <InputGroupInput
                autoFocus
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitUrl()
                  }
                }}
                placeholder='auxx://kb/article/… or https://…'
              />
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  size='xs'
                  onClick={submitUrl}
                  disabled={!urlDraft.trim() || urlDraft.trim() === mode?.initialHref}>
                  Save
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <p className='text-muted-foreground mt-2 px-1 text-xs'>
              Or pick a different article below.
            </p>
          </div>
        ) : null}
        <ArticlePicker
          knowledgeBaseId={knowledgeBaseId}
          allowedKinds={['page', 'link']}
          drillableKinds={['tab', 'category', 'header']}
          rootLabel={isEdit ? 'Pick article' : 'Link to article'}
          searchPlaceholder='Search articles…'
          flattenSearch
          onPick={(articleId) => {
            const found = articles.find((a) => a.id === articleId)
            const href = buildAuxxArticleUrl(articleId)
            // In edit mode, keep the existing visible text unless it matches
            // the previous href (i.e. the user never gave it a custom label).
            const prevHrefIsLabel =
              isEdit && mode?.initialText && mode.initialText === mode.initialHref
            const text =
              isEdit && mode?.initialText && !prevHrefIsLabel
                ? mode.initialText
                : found?.title || 'article'
            onPick({ href, text })
            onOpenChange(false)
          }}
          onClose={() => onOpenChange(false)}
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
