// apps/web/src/components/kb/ui/editor/crawl-section-picker.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { pluralize } from '@auxx/utils'

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
  const allSelected = sections.length > 0 && sections.every((s) => selectedPaths.includes(s.path))

  const toggleAll = (checked: boolean) => {
    for (const section of sections) onToggle(section.path, checked)
  }

  return (
    <div className='rounded-xl border'>
      {sections.length > 0 && (
        <div className='flex items-center justify-between border-b px-3 py-2'>
          <span className='text-muted-foreground text-sm'>
            {allSelected ? 'Deselect all' : 'Select all'}
          </span>
          <Switch size='xs' checked={allSelected} onCheckedChange={(c) => toggleAll(c === true)} />
        </div>
      )}
      <ScrollArea className={className} scrollbarClassName='w-1!'>
        <div className='flex flex-col gap-0.5 pe-3'>
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
                title={section.title ?? section.path}
                onTitleClick={() => onToggle(section.path, !checked)}
                rowClassName='hover:bg-muted/50'
                secondary={`${countPages(section)} ${pluralize(countPages(section), 'page')}`}
                actions={
                  <Switch
                    size='xs'
                    checked={checked}
                    onCheckedChange={(c) => onToggle(section.path, c === true)}
                  />
                }
              />
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
