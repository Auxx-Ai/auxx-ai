// apps/web/src/components/detail-view/tabs/timeline-tab.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TimelineTab as TimelineTabCore } from '~/components/timeline'
import type { DetailViewTabProps } from '../types'

/** Recent-N entry count for the `variant='section'` preview (04-ui.md §6: "recent-N + more"). */
const SECTION_RECENT_LIMIT = 10

/**
 * TimelineTab - wrapper for the core TimelineTab component
 * Used in detail view main tabs area.
 *
 * `variant='tab'` (default, UNCHANGED): owns its own full-height `ScrollArea` — the
 * `TabsContent` parent gives it `flex-1 h-full` to fill.
 * `variant='section'`: renders at intrinsic height inside a `DetailViewSections`
 * `<Section>` — no own `ScrollArea` (the outer page owns scroll), and the core
 * `TimelineTabCore` is capped to a recent-N page; its existing infinite-query
 * "Load more" button (unchanged component) already IS the "Show more" affordance.
 */
export function TimelineTab({ recordId, variant = 'tab' }: DetailViewTabProps) {
  if (variant === 'section') {
    return <TimelineTabCore recordId={recordId} limit={SECTION_RECENT_LIMIT} />
  }

  return (
    <ScrollArea className='flex-1'>
      <div className='p-3 sm:p-6 flex-1 flex-col flex'>
        <TimelineTabCore recordId={recordId} />
      </div>
    </ScrollArea>
  )
}

export default TimelineTab
