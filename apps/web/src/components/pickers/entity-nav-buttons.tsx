// apps/web/src/components/pickers/entity-nav-buttons.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { useHotkey } from '@tanstack/react-hotkeys'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { EntityListNav } from './use-entity-list-nav'

export interface EntityNavButtonsProps {
  nav: EntityListNav
  /** Whether J/K are active. Defaults to true. */
  hotkeysEnabled?: boolean
  /**
   * What to call the list when the open entity is missing from it, e.g.
   * `'Workflows'` renders "Not in Workflows".
   */
  orphanLabel?: string
}

/**
 * Previous / next within an entity switcher's list — the top-level-entity
 * counterpart of `records/nav/record-nav-buttons.tsx` and
 * `mail/thread-nav-toolbar.tsx`, minus the back button (the breadcrumb parent
 * already is the way back).
 *
 * `J`/`K` match the bindings those two surfaces use. The hotkeys manager ignores
 * form fields and `contenteditable` by default, so typing is unaffected.
 */
export function EntityNavButtons({
  nav,
  hotkeysEnabled = true,
  orphanLabel,
}: EntityNavButtonsProps) {
  const { hasPrev, hasNext, goPrev, goNext, index } = nav

  useHotkey('K', goPrev, { enabled: hotkeysEnabled, conflictBehavior: 'allow' })
  useHotkey('J', goNext, { enabled: hotkeysEnabled, conflictBehavior: 'allow' })

  // The entity is not in the list — deleted elsewhere, archived, or beyond a
  // truncated window. Say so rather than leaving two dead buttons with no
  // explanation.
  const orphaned = index < 0
  const orphanTip = orphanLabel ? `Not in ${orphanLabel}` : 'Not in this list'

  return (
    <div className='flex items-center'>
      <Tooltip content={orphaned ? orphanTip : 'Previous'} shortcut={orphaned ? undefined : 'K'}>
        <Button
          variant='ghost'
          size='icon-sm'
          className='rounded-lg hover:bg-primary-200'
          disabled={!hasPrev}
          onClick={goPrev}
          aria-label='Previous'>
          <ChevronUp />
        </Button>
      </Tooltip>
      <Tooltip content={orphaned ? orphanTip : 'Next'} shortcut={orphaned ? undefined : 'J'}>
        <Button
          variant='ghost'
          size='icon-sm'
          className='rounded-lg hover:bg-primary-200'
          disabled={!hasNext}
          onClick={goNext}
          aria-label='Next'>
          <ChevronDown />
        </Button>
      </Tooltip>
    </div>
  )
}
