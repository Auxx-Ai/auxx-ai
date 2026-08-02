// apps/web/src/components/mail-filters/ui/create-filter-from-search-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { FunnelPlus } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import type { SearchCondition } from '~/components/searchbar/types'
import { useAuthorableInboxes } from '../hooks/use-authorable-inboxes'
import {
  convertSearchConditions,
  hasConvertibleSearchConditions,
} from '../utils/prefill-conditions'
import { MailFilterPrefillDialog } from './mail-filter-prefill-dialog'

interface CreateFilterFromSearchButtonProps {
  /** The searchbar's live conditions — the exact value the mail list is showing. */
  conditions: SearchCondition[]
}

/**
 * "Create filter from this search" — the searchbar's creation entry point
 * (§6.3).
 *
 * This is *why* the condition shape must not fork: the searchbar's
 * `SearchCondition[]` and the filter's `ConditionGroup[]` are the same field
 * catalog and the same operators over one evaluator (invariant 5), so handing
 * one to the other is a re-wrap rather than a translation.
 *
 * The three fields that genuinely cannot survive the trip — `freeText`, `inbox`
 * and `sharedWithMe` — are converted by `convertSearchConditions` and every
 * change it makes is rendered as a **visible banner** in the dialog. A silently
 * widened `freeText` would produce a filter that mutates mail the search never
 * showed.
 *
 * Hidden entirely when the caller may author on no inbox (§5.1/§6.4) — the same
 * gate the settings section and the thread menu use, never admin rank.
 */
export function CreateFilterFromSearchButton({ conditions }: CreateFilterFromSearchButtonProps) {
  const [open, setOpen] = useState(false)
  const { canAuthorAny } = useAuthorableInboxes()
  const isOfferable = canAuthorAny && hasConvertibleSearchConditions(conditions)

  return (
    <>
      {isOfferable && (
        <Tooltip content='Create a filter from this search' delayDuration={300}>
          <Button
            variant='ghost'
            size='icon'
            className='size-7 shrink-0 rounded-full hover:bg-foreground/10'
            onClick={() => setOpen(true)}>
            <FunnelPlus />
            <span className='sr-only'>Create filter from this search</span>
          </Button>
        </Tooltip>
      )}
      {open && <SearchPrefillDialog conditions={conditions} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Converts once, on mount.
 *
 * Mounted only while open so the conversion — and the notes the dialog shows —
 * describe the search as it stood when the button was clicked, not whatever the
 * user typed into the searchbar afterwards.
 */
function SearchPrefillDialog({
  conditions,
  onClose,
}: {
  conditions: SearchCondition[]
  onClose: () => void
}) {
  const [conversion] = useState(() => convertSearchConditions(conditions))

  return (
    <MailFilterPrefillDialog
      onClose={onClose}
      conditions={conversion.groups}
      inboxId={conversion.inboxId}
      notes={conversion.notes}
    />
  )
}
