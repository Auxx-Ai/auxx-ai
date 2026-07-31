// apps/web/src/components/records/nav/record-nav-buttons.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useHotkey } from '@tanstack/react-hotkeys'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { RecordNavContext } from './use-record-nav-context'

interface RecordNavButtonsProps {
  context: RecordNavContext
  /** Whether J/K are active. Defaults to true. */
  hotkeysEnabled?: boolean
}

/**
 * Previous / next within the list the detail page was opened from — the record
 * counterpart of `mail/thread-nav-toolbar.tsx`, minus its back button (the
 * breadcrumb parent already is the way back).
 *
 * `J`/`K` match mail's bindings. The two surfaces never coexist, and nothing
 * else on the records detail page claims either key.
 */
export function RecordNavButtons({ context, hotkeysEnabled = true }: RecordNavButtonsProps) {
  const { hasPrev, hasNext, goPrev, goNext, index, descriptor } = context

  useHotkey('K', goPrev, { enabled: hotkeysEnabled, conflictBehavior: 'allow' })
  useHotkey('J', goNext, { enabled: hotkeysEnabled, conflictBehavior: 'allow' })

  // The record is not in the list — it was filtered out after an edit, or it sits
  // beyond the window a deep link could load. Say so rather than leaving two
  // dead buttons with no explanation.
  const orphaned = index < 0
  const prevTip = orphaned ? `Not in ${descriptor.label}` : 'Previous'
  const nextTip = orphaned ? `Not in ${descriptor.label}` : 'Next'

  return (
    <div className='flex items-center'>
      <Tooltip content={prevTip} shortcut={orphaned ? undefined : 'K'}>
        <Button
          variant='ghost'
          size='icon-sm'
          className='rounded-lg hover:bg-primary-200'
          disabled={!hasPrev}
          onClick={goPrev}
          aria-label='Previous record'>
          <ChevronUp />
        </Button>
      </Tooltip>
      <Tooltip content={nextTip} shortcut={orphaned ? undefined : 'J'}>
        <Button
          variant='ghost'
          size='icon-sm'
          className='rounded-lg hover:bg-primary-200'
          disabled={!hasNext}
          onClick={goNext}
          aria-label='Next record'>
          <ChevronDown />
        </Button>
      </Tooltip>
    </div>
  )
}
