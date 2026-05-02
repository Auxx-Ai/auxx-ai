// apps/web/src/components/editor/kb-article/article-link-popover.tsx
'use client'

import { Popover, PopoverAnchor, PopoverContentDialogAware } from '@auxx/ui/components/popover'
import { buildAuxxArticleUrl } from '@auxx/utils'
import { useMemo, useRef } from 'react'
import { useArticleList } from '~/components/kb/hooks/use-article-list'
import { ArticlePicker } from '~/components/kb/ui/articles/article-picker'

export interface ArticleLinkPick {
  /** Insertable href (auxx://kb/article/{id}). */
  href: string
  /** Visible link text — the article title. */
  text: string
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
}

export function ArticleLinkPopover({
  open,
  onOpenChange,
  knowledgeBaseId,
  onPick,
  children,
  anchorRect,
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

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchorEl}
      <PopoverContentDialogAware
        align='start'
        sideOffset={8}
        className='p-0'
        onOpenAutoFocus={(e) => {
          // Let the cmdk input inside ArticlePicker handle its own focus.
          e.preventDefault()
        }}
        onFocusOutside={(e) => {
          // cmdk re-renders the CommandList on drill-down, which briefly
          // unmounts the focused element. Browser focus shifts to a sibling
          // input outside the popover, which Radix would otherwise treat as
          // a dismissal. Ignore focus-driven dismissals — only real pointer
          // clicks outside should close the picker.
          e.preventDefault()
        }}>
        <ArticlePicker
          knowledgeBaseId={knowledgeBaseId}
          allowedKinds={['page', 'link']}
          drillableKinds={['tab', 'category', 'header']}
          rootLabel='Link to article'
          searchPlaceholder='Search articles…'
          flattenSearch
          onPick={(articleId) => {
            const found = articles.find((a) => a.id === articleId)
            onPick({
              href: buildAuxxArticleUrl(articleId),
              text: found?.title || 'article',
            })
            onOpenChange(false)
          }}
          onClose={() => onOpenChange(false)}
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
