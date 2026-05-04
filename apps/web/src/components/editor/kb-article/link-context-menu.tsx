// apps/web/src/components/editor/kb-article/link-context-menu.tsx
'use client'

import {
  menuContentStyles,
  menuItemStyles,
  menuSeparatorStyles,
  menuVariants,
} from '@auxx/ui/components/menu-styles'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { isAuxxUrl, parseAuxxArticleUrl } from '@auxx/utils'
import { Copy, ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'

export interface LinkContextMenuTarget {
  rect: DOMRect
  href: string
}

interface Props {
  target: LinkContextMenuTarget | null
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onRemove: () => void
  /**
   * Resolve an internal article id to an admin-editor href. Returns `null`
   * when no kb context is available — in that case the "Open" item is hidden
   * and Copy falls back to the raw `auxx://` reference.
   */
  buildInternalEditorHref: (articleId: string) => string | null
}

export function LinkContextMenu({
  target,
  onOpenChange,
  onEdit,
  onRemove,
  buildInternalEditorHref,
}: Props) {
  // Cache the last valid rect so the close animation doesn't snap to (0,0)
  // when `target` clears. Floating UI re-measures during close — without
  // this, it reads a fresh DOMRect (origin) and the menu visibly flies to
  // the top-left corner mid-animation. Mirrors `inline-picker-popover.tsx`.
  const lastRectRef = useRef<DOMRect>(new DOMRect())
  if (target?.rect) lastRectRef.current = target.rect
  const virtualRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => lastRectRef.current,
  })

  const href = target?.href ?? ''
  const internalRef = useMemo(() => parseAuxxArticleUrl(href), [href])
  const isInternal = isAuxxUrl(href)

  const internalEditorHref =
    isInternal && internalRef ? buildInternalEditorHref(internalRef.articleId) : null
  const openHref = isInternal ? internalEditorHref : href || null
  const copyValue = isInternal ? (internalEditorHref ?? href) : href

  const handleCopy = () => {
    if (copyValue) void navigator.clipboard.writeText(copyValue)
    onOpenChange(false)
  }

  const open = target !== null

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        align='start'
        sideOffset={4}
        className={cn(...menuContentStyles, 'w-44')}
        onOpenAutoFocus={(e) => e.preventDefault()}>
        <button
          type='button'
          className={cn(menuVariants({}), menuItemStyles, 'w-full')}
          onClick={() => {
            onEdit()
            onOpenChange(false)
          }}>
          <Pencil />
          Edit link
        </button>
        {openHref ? (
          <a
            href={openHref}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(menuVariants({}), menuItemStyles, 'w-full')}
            onClick={() => onOpenChange(false)}>
            <ExternalLink />
            {isInternal ? 'Open article' : 'Open link'}
          </a>
        ) : null}
        {copyValue ? (
          <button
            type='button'
            className={cn(menuVariants({}), menuItemStyles, 'w-full')}
            onClick={handleCopy}>
            <Copy />
            Copy {isInternal ? 'article URL' : 'URL'}
          </button>
        ) : null}
        <div className={cn(menuSeparatorStyles)} />
        <button
          type='button'
          className={cn(menuVariants({ variant: 'destructive' }), menuItemStyles, 'w-full')}
          onClick={() => {
            onRemove()
            onOpenChange(false)
          }}>
          <Trash2 />
          Remove link
        </button>
      </PopoverContent>
    </Popover>
  )
}
