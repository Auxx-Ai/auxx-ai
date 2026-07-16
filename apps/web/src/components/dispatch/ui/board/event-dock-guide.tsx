// apps/web/src/components/dispatch/ui/board/event-dock-guide.tsx

'use client'

import { useDockChrome } from '@auxx/ui/components/dock-panel'
import {
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideConcepts,
  GuideShortcut,
  GuideShortcuts,
} from '@auxx/ui/components/guide'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { ArrowLeftRight, PanelRightOpen, X } from 'lucide-react'

function DockControl({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <SimpleTooltip content={label}>
      <button
        type='button'
        aria-label={label}
        onClick={onClick}
        className='shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4'>
        {children}
      </button>
    </SimpleTooltip>
  )
}

/**
 * Empty state for the docked event panel (plan 21 §"Empty-state guide") — shown when
 * `activeVisitId` is `null` while docked. Built straight from the container-agnostic
 * `@auxx/ui/components/guide` content primitives (no `GuideDialog` wrapper; the panel itself
 * is the surface), replicating `GuideDialog`'s `p-6` body padding.
 */
export function EventDockGuide() {
  const dock = useDockChrome()

  return (
    <div>
      {dock && (
        <div className='sticky top-0 z-10 flex items-center justify-end gap-0.5 border-b border-border/50 bg-background px-3 py-2'>
          {dock.onFlipSide && (
            <DockControl
              label='Flip side'
              onClick={() => dock.onFlipSide?.(dock.side === 'left' ? 'right' : 'left')}>
              <ArrowLeftRight />
            </DockControl>
          )}
          {dock.onPopOut && (
            <DockControl label='Pop out' onClick={dock.onPopOut}>
              <PanelRightOpen />
            </DockControl>
          )}
          {dock.onClose && (
            <DockControl label='Close' onClick={dock.onClose}>
              <X />
            </DockControl>
          )}
        </div>
      )}
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
    </div>
  )
}
