// packages/ui/src/components/kb/article/kb-article-with-toc.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { List } from 'lucide-react'
import { useState } from 'react'
import { extractKBHeadings } from './extract-headings'
import { KBArticleRenderer, type KBArticleRendererProps } from './kb-article-renderer'
import { KBTableOfContents } from './kb-toc'

type KBArticleWithTocProps = Omit<KBArticleRendererProps, 'tocToggle'>

/**
 * Two-column layout: TOC rail on the right, article on the left. Owns the
 * desktop "rail collapsed" state — clicking "On this page" hides the rail
 * and reveals an icon button next to the copy menu that re-expands it.
 * Mobile is unaffected (the renderer's own drawer handles small screens).
 */
export function KBArticleWithToc(props: KBArticleWithTocProps) {
  const [collapsed, setCollapsed] = useState(false)
  const headings = props.doc ? extractKBHeadings(props.doc) : []
  const hasHeadings = headings.length > 0
  const showRail = hasHeadings && !collapsed

  const desktopToggle = hasHeadings ? (
    <Button
      variant='outline'
      size='icon-xs'
      aria-label='Show table of contents'
      onClick={() => setCollapsed(false)}
      className={cn('hidden @kb-lg:inline-flex', !collapsed && 'invisible')}>
      <List />
    </Button>
  ) : null

  return (
    <div className='flex flex-col gap-6 @kb-lg:flex-row @kb-lg:items-start'>
      <aside
        className={cn(
          'hidden @kb-lg:order-2 @kb-lg:sticky @kb-lg:top-[calc(var(--kb-top-offset,0px)+5rem)] @kb-lg:max-h-[calc(100dvh-var(--kb-top-offset,0px)-5rem)] @kb-lg:w-64 @kb-lg:max-w-none @kb-lg:flex-none @kb-lg:overflow-y-auto @kb-lg:px-4 @kb-lg:pt-8',
          showRail && '@kb-lg:block'
        )}>
        <KBTableOfContents headings={headings} onCollapse={() => setCollapsed(true)} />
      </aside>
      <div
        className='min-w-0 flex-1 @kb-lg:order-1'
        data-kb-toc-collapsed={hasHeadings && collapsed ? 'true' : undefined}>
        <KBArticleRenderer {...props} tocToggle={desktopToggle} />
      </div>
    </div>
  )
}
