// packages/ui/src/components/kb/article/kb-toc-drawer.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@auxx/ui/components/sheet'
import { List } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KBHeading } from './extract-headings'
import { KBTableOfContents } from './kb-toc'

interface KBTableOfContentsDrawerProps {
  headings: KBHeading[]
  className?: string
}

/**
 * Compact trigger + right-side drawer rendering the article's TOC.
 * Used on small screens where the inline TOC rail is hidden.
 *
 * KB theme vars (`--kb-*`) are scoped to `[data-kb-id="<id>"]` and the Sheet
 * portals to document.body, escaping that scope. We mirror the kb-id onto a
 * wrapper inside the SheetContent so the same CSS rule cascades into the
 * portaled subtree.
 */
export function KBTableOfContentsDrawer({ headings, className }: KBTableOfContentsDrawerProps) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [kbId, setKbId] = useState<string | undefined>()

  useEffect(() => {
    const id = anchorRef.current?.closest('[data-kb-id]')?.getAttribute('data-kb-id')
    setKbId(id ?? undefined)
  }, [])

  if (headings.length === 0) return null

  return (
    <span ref={anchorRef} className='contents'>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant='outline' size='icon' aria-label='On this page' className={className}>
            <List />
          </Button>
        </SheetTrigger>
        <SheetContent side='right' className='overflow-y-auto'>
          <div
            data-kb-id={kbId}
            className='flex flex-col gap-4 bg-[var(--kb-page-bg)] text-[var(--kb-fg)]'>
            <SheetHeader>
              <SheetTitle className='text-[var(--kb-fg)]'>On this page</SheetTitle>
            </SheetHeader>
            <KBTableOfContents headings={headings} hideHeading onLinkClick={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </span>
  )
}
