// apps/web/src/components/detail-view/tabs/timeline-tab.tsx
'use client'

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { TimelineTab as TimelineTabCore } from '~/components/timeline'
import type { DetailViewTabProps } from '../types'

/**
 * TimelineTab - wrapper for the core TimelineTab component
 * Used in detail view main tabs area
 */
export function TimelineTab({ recordId }: DetailViewTabProps) {
  return (
    <ScrollArea className='flex-1'>
      <div className='p-6 flex-1 flex-col flex'>
        <TimelineTabCore recordId={recordId} />
      </div>
    </ScrollArea>
  )
}

export default TimelineTab
