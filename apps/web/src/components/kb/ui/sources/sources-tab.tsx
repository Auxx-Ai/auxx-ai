// apps/web/src/components/kb/ui/sources/sources-tab.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { SourcesEmptyState } from './sources-empty-state'
import { SourcesFilterBar } from './sources-filter-bar'
import { SourcesGridView } from './sources-grid-view'
import { useSources } from './sources-provider'

/** Sources tab body: filter bar → card grid / empty / skeleton. */
export function SourcesTab() {
  const { items, isLoading } = useSources()

  return (
    <>
      <div className='sticky top-0 z-10 backdrop-blur-sm shrink-0'>
        <SourcesFilterBar />
      </div>
      <ScrollArea className='flex-1 min-h-0 @container'>
        {isLoading ? (
          <div className='grid gap-4 @md:grid-cols-2 @lg:grid-cols-3 @xl:grid-cols-4 p-3'>
            {Array.from({ length: 8 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton placeholder
              <Skeleton key={i} className='h-24 rounded-2xl' />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className='flex h-full items-center justify-center p-6'>
            <SourcesEmptyState />
          </div>
        ) : (
          <SourcesGridView />
        )}
      </ScrollArea>
    </>
  )
}
