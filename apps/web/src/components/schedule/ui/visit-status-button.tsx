// apps/web/src/components/schedule/ui/visit-status-button.tsx
//
// The Visit tab's one-thumb advancing status button (08-worker-surface.md §1/§3): a single
// primary action that moves a visit forward — `scheduled` → "Start travel" → `en_route` →
// "Arrived" → `on_site` → "Complete…" (opens the close chooser, `visit-close-chooser.tsx`).
// `done`/`canceled` render a static state chip instead of a button. WS1 deliberately omits
// Cancel here — canceled isn't in `advanceMyVisit`'s enum, office cancels on the board.

'use client'

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { VisitCloseChooser } from './visit-close-chooser'

/**
 * Mirrors `VisitStatus` (`packages/lib/src/dispatch/types.ts:27`) — `@auxx/lib/dispatch` has no
 * `/client` export subpath (server-only deps), so the union is duplicated here rather than
 * imported, per the board's `board/types.ts` precedent.
 */
export type VisitStatus = 'scheduled' | 'en_route' | 'on_site' | 'done' | 'canceled'

/** Badge tone for the static done/canceled chip — matches the board's status palette. */
const STATE_CHIP_VARIANT: Partial<Record<VisitStatus, Variant>> = {
  done: 'green',
  canceled: 'red',
}

const STATE_CHIP_LABEL: Partial<Record<VisitStatus, string>> = {
  done: 'Done',
  canceled: 'Canceled',
}

/** Forward advance target + button label for each in-progress status. `on_site` has no entry —
 * it renders "Complete…" instead (opens the close chooser, not a direct advance). */
const ADVANCE_STEP: Partial<Record<VisitStatus, { to: 'en_route' | 'on_site'; label: string }>> = {
  scheduled: { to: 'en_route', label: 'Start travel' },
  en_route: { to: 'on_site', label: 'Arrived' },
}

/** Undo target for each in-progress status — the overflow menu's "Undo last". */
const UNDO_STEP: Partial<Record<VisitStatus, 'scheduled' | 'en_route'>> = {
  en_route: 'scheduled',
  on_site: 'en_route',
}

interface VisitStatusButtonProps {
  visitId: string
  status: VisitStatus
  /** Whether the work order has a customer attached — threaded to the close chooser's
   * "Close job & invoice" disabled state (08 §3). */
  hasContact: boolean
}

/**
 * Advancing status button + overflow ("Undo last") + the close chooser it opens on
 * "Complete…". Manages the chooser's open state internally so callers only need the visit's
 * `id`/`status` (+ `hasContact`, threaded through to the chooser).
 */
export function VisitStatusButton({ visitId, status, hasContact }: VisitStatusButtonProps) {
  const [chooserOpen, setChooserOpen] = useState(false)
  const utils = api.useUtils()

  const advance = api.dispatch.advanceMyVisit.useMutation({
    onSuccess: () => utils.dispatch.getMyVisit.invalidate({ visitId }),
    onError: (error) => toastError({ title: 'Error updating visit', description: error.message }),
  })

  if (status === 'done' || status === 'canceled') {
    return (
      <div className='flex items-center gap-2'>
        <Badge variant={STATE_CHIP_VARIANT[status]} size='sm'>
          {STATE_CHIP_LABEL[status]}
        </Badge>
        {/* M3 "location sharing active" indicator lands here (02-tracking-pipeline.md §1). */}
      </div>
    )
  }

  const step = ADVANCE_STEP[status]
  const undoTo = UNDO_STEP[status]

  return (
    <div className='flex items-center gap-2'>
      {step ? (
        <Button
          className='flex-1'
          onClick={() => advance.mutate({ visitId, to: step.to })}
          loading={advance.isPending}
          loadingText='Updating…'>
          {step.label}
        </Button>
      ) : (
        <Button className='flex-1' onClick={() => setChooserOpen(true)}>
          Complete…
        </Button>
      )}

      {/* M3 "location sharing active" indicator lands here (02-tracking-pipeline.md §1). */}

      {undoTo && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' aria-label='More actions'>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={() => advance.mutate({ visitId, to: undoTo })}
              disabled={advance.isPending}>
              Undo last
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <VisitCloseChooser
        visitId={visitId}
        hasContact={hasContact}
        open={chooserOpen}
        onOpenChange={setChooserOpen}
      />
    </div>
  )
}
