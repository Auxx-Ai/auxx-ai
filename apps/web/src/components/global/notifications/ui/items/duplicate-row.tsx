// apps/web/src/components/global/notifications/ui/items/duplicate-row.tsx
'use client'

import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Clock, CopyCheck, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { DuplicatePairSummary } from '~/components/duplicates/ui/duplicate-pair-summary'
import { BlockCardActionButton } from '~/components/kopilot/ui/blocks/block-card'
import { MergeDialog } from '~/components/merge/merge-dialog'
import { api, type RouterOutputs } from '~/trpc/react'
import { NotificationRow } from '../notification-row'

type DuplicatePairItem = RouterOutputs['duplicates']['list']['items'][number]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * One duplicate suggestion, triaged inline in the Approvals tab's fifth section
 * (plan §3.2).
 *
 * A sibling of `MailSuggestionRow` rather than a mode of it: like mail
 * suggestions, **nothing here is backed by a `Notification` row** — the tab
 * reads source tables directly and `DuplicateSuggestion` is one, so minting a
 * notification per pair would create two lifecycles over one thing. Unlike
 * every other row in this tab, the primary action opens a DIALOG rather than
 * resolving in place: a merge is destructive and irreversible-feeling, so it
 * gets the full preview surface the merge dialog already provides.
 *
 * The row mounts its own `MergeDialog` (the `ticket-row-actions.tsx`
 * precedent) — the notification panel has no dialog host to borrow.
 *
 * Snooze is in the overflow rather than the footer, mirroring `SuggestionRow`:
 * a snoozed pair is `open` plus a future `snoozeUntil`, so it returns to this
 * queue on its own with no sweep to un-snooze it.
 */
export function DuplicateRow({
  pair,
  onResolved,
}: {
  pair: DuplicatePairItem
  onResolved: () => void
}) {
  const [mergeOpen, setMergeOpen] = useState(false)

  const dismiss = api.duplicates.dismiss.useMutation({
    onSuccess: () => onResolved(),
    onError: (error) => {
      toastError({ title: 'Dismiss failed', description: error.message })
      onResolved()
    },
  })

  /**
   * Best-established first, decided server-side (plan §3.4): the dialog defaults
   * its target to the FIRST id, and in canonical pair order that is whichever
   * cuid2 sorts lower. Since the target is the record whose id survives, letting
   * pair order pick it is how "merged into the empty stub" happens.
   */
  const mergeRecordIds: RecordId[] = pair.mergeInstanceIds.map((id) =>
    toRecordId(pair.entityDefinitionId, id)
  )

  /**
   * The whole CLUSTER, not two sides. The router emits one item per connected
   * component, so a three-record cluster is one card listing three records —
   * previously it was three cards offering the same merge, two of which read as
   * the same pair reversed.
   */
  const records = pair.records.map((side) => ({
    recordId: toRecordId(pair.entityDefinitionId, side.instanceId),
    displayName: side.displayName,
    secondaryDisplayValue: side.secondaryDisplayValue,
    avatarUrl: side.avatarUrl,
  }))

  const snooze = (ms: number) =>
    dismiss.mutate({ pairId: pair.id, snoozeUntil: new Date(Date.now() + ms) })

  const overflow = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* size-7 + rounded-full so the trigger sits level with the h-7 pills. */}
        <Button
          variant='ghost'
          size='icon-sm'
          className='size-7 rounded-full'
          aria-label='Duplicate actions'>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-56'>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={dismiss.isPending}>
            <Clock />
            Snooze
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className='w-56'>
            <DropdownMenuLabel className='font-normal text-muted-foreground text-xs'>
              Hide this pair until:
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => snooze(7 * DAY_MS)}>Next week</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => snooze(30 * DAY_MS)}>Next month</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <NotificationRow
        id={pair.id}
        createdAt={new Date(pair.createdAt)}
        label='Possible duplicate'
        icon={<CopyCheck className='size-4' />}
        actions={
          <>
            {overflow}
            <BlockCardActionButton
              label='Dismiss'
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate({ pairId: pair.id })}
            />
            <BlockCardActionButton
              label='Review & merge'
              primary
              disabled={dismiss.isPending}
              onClick={() => setMergeOpen(true)}
            />
          </>
        }>
        <DuplicatePairSummary records={records} band={pair.band} signals={pair.signals} />
      </NotificationRow>

      {mergeOpen ? (
        <MergeDialog
          open
          onOpenChange={setMergeOpen}
          baseRecordIds={mergeRecordIds}
          // No `targetRecordId`: the dialog defaults to the first id, which is
          // already the best-established record. The user can still override.
          onMergeComplete={() => {
            setMergeOpen(false)
            onResolved()
          }}
        />
      ) : null}
    </>
  )
}
