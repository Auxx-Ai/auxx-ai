// apps/web/src/components/mail-filters/ui/mail-filter-prefill-dialog.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { Alert } from '@auxx/ui/components/alert'
import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMailFilters } from '../hooks/use-mail-filters'
import { MailFilterDialog } from './mail-filter-dialog'

interface MailFilterPrefillDialogProps {
  onClose: () => void
  /** Seed name — the entry point's best guess, always editable. */
  name?: string
  /** Seed conditions, already in the dialog's `ConditionGroup[]` shape. */
  conditions: ConditionGroup[]
  /** Preselected inbox (an EntityInstance id, as `authorableInboxes` returns). */
  inboxId?: string
  /** Plain-language differences between the source and the filter (§6.3). */
  notes?: string[]
}

/**
 * Opens the EXISTING {@link MailFilterDialog} with a prefill — the one launcher
 * behind both creation entry points (§6.3): the thread overflow menu and the
 * searchbar's "Create filter from this search".
 *
 * There is deliberately no second dialog. The entry points differ only in how
 * they build `ConditionGroup[]`; everything downstream — the condition editor,
 * the action catalog, the preview footer, the limit gate — is the settings
 * dialog, unchanged.
 *
 * **Mount it conditionally** (`{open && <MailFilterPrefillDialog … />}`). It
 * freezes its prefill on mount so the form can never be re-seeded out from under
 * someone mid-edit, which means a remount is how you change the prefill.
 */
export function MailFilterPrefillDialog({
  onClose,
  name,
  conditions,
  inboxId,
  notes,
}: MailFilterPrefillDialogProps) {
  const { list, inboxes } = useMailFilters()
  const inboxRows = useMemo(() => inboxes.data ?? [], [inboxes.data])
  const filters = useMemo(() => list.data ?? [], [list.data])

  // Frozen on mount: `MailFilterDialog` re-seeds its form whenever these change,
  // so a fresh array identity every render would erase what the user typed.
  const [seed] = useState(() => ({ name, conditions }))

  /**
   * Only offer an inbox the router would actually accept. A prefilled inbox that
   * is not in `authorableInboxes` (the searchbar can be scoped to an inbox the
   * caller reads but cannot write filters for) must fall back to the picker
   * rather than being silently sent and refused on save.
   */
  const preselectedInboxId = useMemo(() => {
    if (inboxId && inboxRows.some((row) => row.id === inboxId)) return inboxId
    return inboxRows.length === 1 ? inboxRows[0]?.id : undefined
  }, [inboxId, inboxRows])

  const notice = useMemo(() => {
    if (!notes || notes.length === 0) return undefined
    return (
      <Alert variant='warning'>
        {/* The icon is nested, not a direct child: `Alert` absolutely positions
            its own `> svg`, which would take it out of this flow. */}
        <div className='flex items-start gap-2'>
          <Info className='mt-0.5 size-4 shrink-0' />
          <div className='space-y-1.5'>
            <p className='font-medium'>This filter is not exactly what you started from</p>
            {notes.map((note) => (
              <p key={note} className='text-xs leading-relaxed opacity-90'>
                {note}
              </p>
            ))}
          </div>
        </div>
      </Alert>
    )
  }, [notes])

  return (
    <MailFilterDialog
      open
      onClose={onClose}
      filter={null}
      inboxes={inboxRows}
      filters={filters}
      defaultInboxId={preselectedInboxId}
      defaultName={seed.name}
      defaultConditions={seed.conditions}
      notice={notice}
    />
  )
}
