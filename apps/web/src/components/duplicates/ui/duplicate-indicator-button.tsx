// apps/web/src/components/duplicates/ui/duplicate-indicator-button.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { Button, type ButtonProps } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { CopyCheck } from 'lucide-react'
import { useState } from 'react'
import { MergeDialog } from '~/components/merge/merge-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import {
  DuplicateBandBadge,
  DuplicateRecordCard,
  DuplicateSignalChips,
} from './duplicate-pair-summary'

/**
 * The per-record duplicates affordance, mounted in BOTH record headers
 * (plan §3.3) — the drawer's icon cluster and the detail page's action cluster,
 * the same two mount points `FavoriteStarButton` has.
 *
 * **It renders NOTHING when the record has no open pairs**, which is nearly
 * every record. That is the whole design constraint: a header badge that is
 * present-but-empty on every contact in the org would be pure noise, so the
 * component's default state is absence, not an empty popover.
 *
 * It mounts its OWN `MergeDialog` (the `ticket-row-actions.tsx` precedent).
 * Neither header owns one any more — merge moved into the shared
 * `RecordActionsMenu` — so borrowing one would mean threading dialog state up
 * through two unrelated headers.
 *
 * The query is doubly lazy: gated on the plan feature AND on `enabled`, which
 * the drawer passes as `!!open`. A closed drawer costs the server nothing.
 */
export function DuplicateIndicatorButton({
  recordId,
  enabled = true,
  size = 'icon-sm',
  className,
}: {
  recordId: RecordId
  /** The drawer passes `!!open` — a mounted-but-closed drawer must not query. */
  enabled?: boolean
  size?: ButtonProps['size']
  className?: string
}) {
  const { hasAccess } = useFeatureFlags()
  const featureEnabled = hasAccess(FeatureKey.duplicateDetection)
  const utils = api.useUtils()

  const [open, setOpen] = useState(false)
  const [mergeIds, setMergeIds] = useState<RecordId[] | null>(null)

  const pairs = api.duplicates.forRecord.useQuery(
    { recordId },
    { enabled: featureEnabled && enabled, refetchOnWindowFocus: false }
  )

  const dismiss = api.duplicates.dismiss.useMutation({
    onSuccess: () => {
      void utils.duplicates.forRecord.invalidate()
      void utils.duplicates.list.invalidate()
      void utils.duplicates.count.invalidate()
    },
    onError: (error) => toastError({ title: 'Dismiss failed', description: error.message }),
  })

  const items = pairs.data ?? []
  // Absence, not an empty state — see the component docstring.
  if (!featureEnabled || items.length === 0) return null

  const onMergeComplete = () => {
    setMergeIds(null)
    setOpen(false)
    void utils.duplicates.forRecord.invalidate()
    void utils.duplicates.list.invalidate()
    void utils.duplicates.count.invalidate()
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <SimpleTooltip
          content={`${items.length} possible duplicate${items.length === 1 ? '' : 's'}`}>
          <PopoverTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size={size}
              aria-label='Possible duplicates'
              className={cn('relative', className)}>
              <CopyCheck />
              {/* Count rides the icon rather than sitting beside it: the header
                  clusters are fixed-width icon slots in the drawer. */}
              <span className='-top-0.5 -right-0.5 absolute flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-medium text-white'>
                {items.length > 9 ? '9+' : items.length}
              </span>
            </Button>
          </PopoverTrigger>
        </SimpleTooltip>

        <PopoverContent align='end' className='w-80 p-0'>
          <div className='border-b px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-foreground'>
            Possible duplicates
          </div>
          <div className='flex max-h-96 flex-col divide-y overflow-y-auto'>
            {items.map((pair) => (
              <div key={pair.id} className='flex flex-col gap-2 px-3 py-2.5'>
                <DuplicateRecordCard
                  record={{
                    recordId: toRecordId(pair.entityDefinitionId, pair.other.instanceId),
                    displayName: pair.other.displayName,
                    secondaryDisplayValue: pair.other.secondaryDisplayValue,
                    avatarUrl: pair.other.avatarUrl,
                  }}
                />
                <div className='flex flex-wrap items-center gap-1.5'>
                  <DuplicateBandBadge band={pair.band} />
                  <DuplicateSignalChips signals={pair.signals} />
                </div>
                <div className='flex items-center justify-end gap-1'>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate({ pairId: pair.id })}>
                    Dismiss
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() =>
                      setMergeIds(
                        pair.mergeInstanceIds.map((id) => toRecordId(pair.entityDefinitionId, id))
                      )
                    }>
                    Review & merge
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {mergeIds ? (
        <MergeDialog
          open
          onOpenChange={(next) => !next && setMergeIds(null)}
          baseRecordIds={mergeIds}
          /**
           * The record whose header this is stays the target, whatever the
           * establishment ordering says — a merge started FROM a record is a
           * statement about which one the user is standing on. The ordering
           * still decides the target for the Approvals-tab entry point, which
           * has no such anchor.
           */
          targetRecordId={recordId}
          onMergeComplete={onMergeComplete}
        />
      ) : null}
    </>
  )
}
