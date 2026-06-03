// apps/web/src/components/kb/ui/editor/crawl-section-picker.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TreeRow } from '@auxx/ui/components/tree-row'

/** Local mirror of the crawl provider's SitemapNode (recursive, render-only). */
export interface SitemapNode {
  path: string
  url: string
  title?: string
  isPage: boolean
  children: SitemapNode[]
}

/** Count the leaf pages under a node (inclusive). */
export function countPages(node: SitemapNode): number {
  return (node.isPage ? 1 : 0) + node.children.reduce((sum, c) => sum + countPages(c), 0)
}

interface CrawlSectionTreeProps {
  /** Top-level sections to choose from (`tree.children`). */
  sections: SitemapNode[]
  selectedPaths: string[]
  onToggle: (path: string, checked: boolean) => void
  className?: string
}

/**
 * The site-section checkbox list shared by the Connect wizard and the source
 * settings panel: one row per top-level section with its page count. Selection is
 * the set of section `path`s the crawler ingests (empty = whole site).
 */
export function CrawlSectionTree({
  sections,
  selectedPaths,
  onToggle,
  className = 'h-56',
}: CrawlSectionTreeProps) {
  return (
    <ScrollArea className={`${className} rounded-md border`}>
      <div className='flex flex-col gap-0.5 p-1.5'>
        {sections.length === 0 && (
          <p className='text-muted-foreground p-2 text-sm'>
            No sub-sections found — the whole site will be crawled.
          </p>
        )}
        {sections.map((section) => {
          const checked = selectedPaths.includes(section.path)
          return (
            <TreeRow
              key={section.path}
              icon={
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) => onToggle(section.path, c === true)}
                />
              }
              title={section.title ?? section.path}
              onTitleClick={() => onToggle(section.path, !checked)}
              rowClassName='hover:bg-muted/50'
              actions={
                <Badge variant='secondary' className='shrink-0'>
                  {countPages(section)}
                </Badge>
              }
            />
          )
        })}
      </div>
    </ScrollArea>
  )
}
