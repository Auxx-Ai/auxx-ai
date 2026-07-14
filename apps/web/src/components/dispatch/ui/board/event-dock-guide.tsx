// apps/web/src/components/dispatch/ui/board/event-dock-guide.tsx

'use client'

import {
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideConcepts,
  GuideShortcut,
  GuideShortcuts,
} from '@auxx/ui/components/guide'
import { ArrowLeftRight, PanelRightOpen } from 'lucide-react'

/**
 * Empty state for the docked event panel (plan 21 §"Empty-state guide") — shown when
 * `activeVisitId` is `null` while docked. Built straight from the container-agnostic
 * `@auxx/ui/components/guide` content primitives (no `GuideDialog` wrapper; the panel itself
 * is the surface), replicating `GuideDialog`'s `p-6` body padding.
 */
export function EventDockGuide() {
  return (
    <div className='p-4'>
      <GuideColumns cols={1}>
        <GuideColumn title='Shortcuts'>
          <GuideShortcuts>
            <GuideShortcut keys={['click']} label='Open event details' />
            <GuideShortcut keys={['drag']} label='Reschedule' />
            <GuideShortcut keys={['drag edge']} label='Resize' />
            <GuideShortcut keys={['esc']} label='Close' />
          </GuideShortcuts>
        </GuideColumn>
        <GuideColumn title='This panel'>
          <GuideConcepts>
            <GuideConcept
              glyph={<PanelRightOpen className='size-3.5 text-muted-foreground' />}
              term='Pop out'>
              Undock back into a floating popover anchored to the event.
            </GuideConcept>
            <GuideConcept
              glyph={<ArrowLeftRight className='size-3.5 text-muted-foreground' />}
              term='Flip side'>
              Move the dock to the other side of the calendar.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>
      </GuideColumns>
    </div>
  )
}
