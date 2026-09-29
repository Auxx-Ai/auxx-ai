// apps/web/src/components/manufacturing/stock-setup/check-kinds-step.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { booksStartDate } from '~/components/accounting/books-start'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useAccountingSetupState } from './accounting-status-line'
import {
  type KindRow,
  kindCheckRows,
  type OpeningStockKind,
  partKindLabel,
  toOpeningStockKind,
} from './kind-check'

interface CheckKindsStepProps {
  onChanged: () => void
}

/** Step 1 (plans/mrp/17 §5.1): parts whose kind is unconfirmed or contradicts their BOM. */
export function CheckKindsStep({ onChanged }: CheckKindsStepProps) {
  const utils = api.useUtils()
  const accounting = useAccountingSetupState()
  const conflicts = api.builds.kindConflicts.useQuery(
    {},
    { staleTime: 60_000, refetchOnWindowFocus: false }
  )
  const candidates = api.purchasing.listOpeningStockCandidates.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const setKind = api.purchasing.bulkSetPartKind.useMutation()
  const keepKind = api.builds.confirmKindConflicts.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const rows = useMemo<KindRow[]>(
    () => kindCheckRows(conflicts.data ?? [], candidates.data ?? []),
    [conflicts.data, candidates.data]
  )

  // `onChanged` refreshes the status. Drift and preview are step 2's and refetch when it opens.
  const refresh = (kindsWritten: boolean) => {
    void utils.builds.kindConflicts.invalidate()
    void utils.builds.previewBackflush.invalidate()
    if (kindsWritten) {
      void utils.purchasing.listOpeningStockCandidates.invalidate()
      void utils.builds.movementAccountDrift.invalidate()
    }
    onChanged()
  }

  const withBusy = async (partIds: string[], kindsWritten: boolean, work: () => Promise<void>) => {
    setBusyIds((prev) => new Set([...prev, ...partIds]))
    try {
      await work()
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        for (const id of partIds) next.delete(id)
        return next
      })
      refresh(kindsWritten)
    }
  }

  /** Writes each suggested kind, one call per kind. */
  const applyKinds = (target: KindRow[]) =>
    withBusy(
      target.map((row) => row.partId),
      true,
      async () => {
        const byKind = new Map<OpeningStockKind, string[]>()
        for (const row of target) {
          byKind.set(row.suggestedKind, [...(byKind.get(row.suggestedKind) ?? []), row.partId])
        }
        const names = new Map(rows.map((row) => [row.partId, row.name]))
        try {
          for (const [kind, partIds] of byKind) {
            const { failed } = await setKind.mutateAsync({ partIds, kind })
            if (failed.length > 0) {
              toastError({
                title: `${failed.length} ${failed.length === 1 ? 'part was' : 'parts were'} not changed`,
                description: failed
                  .map((skip) => `${names.get(skip.partId) ?? skip.partId}: ${skip.detail}`)
                  .join('\n'),
              })
            }
          }
        } catch (error) {
          toastError({
            title: 'Error setting the part kind',
            description: (error as Error).message,
          })
        }
      }
    )

  const keep = (row: KindRow) =>
    withBusy([row.partId], !row.isConflict, async () => {
      try {
        if (row.isConflict) await keepKind.mutateAsync({ partIds: [row.partId] })
        else
          await setKind.mutateAsync({
            partIds: [row.partId],
            kind: toOpeningStockKind(row.currentKind) ?? 'component',
          })
      } catch (error) {
        toastError({ title: 'Error keeping the kind', description: (error as Error).message })
      }
    })

  const applyAll = async () => {
    const confirmed = await confirm({
      title: `Apply ${rows.length} suggested ${rows.length === 1 ? 'kind' : 'kinds'}?`,
      description:
        'The kind decides which inventory account the movement is stamped with, and that stamp cannot be edited afterwards.',
      confirmText: 'Apply all',
      cancelText: 'Cancel',
    })
    if (confirmed) await applyKinds(rows)
  }

  const isLoading = conflicts.isPending || candidates.isPending

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6'>
      <div className='flex flex-col gap-1 text-muted-foreground text-sm'>
        <p>
          The kind decides which inventory account a part's stock sits in, and it is fixed on every
          movement when it is written.
        </p>
        {accounting.enabled && accounting.finalized && accounting.cutoffPeriod && (
          <p>
            Movements from {booksStartDate(accounting.cutoffPeriod)} on post to this part's account.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className='flex flex-col gap-2'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : rows.length === 0 ? (
        <div className='flex items-center gap-2 rounded-lg border px-4 py-6 text-sm'>
          <CheckCircle2 className='size-4 text-good-500' />
          Every part's kind is confirmed.
        </div>
      ) : (
        <>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='font-medium text-sm'>
              {rows.length} {rows.length === 1 ? 'part' : 'parts'} to check
            </span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void applyAll()}
              loading={setKind.isPending && busyIds.size > 1}
              loadingText='Applying...'
              disabled={busyIds.size > 0}>
              Apply all suggestions
            </Button>
          </div>
          <ul className='flex flex-col divide-y rounded-lg border'>
            {rows.map((row) => {
              const busy = busyIds.has(row.partId)
              return (
                <li
                  key={row.partId}
                  className='flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4'>
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <span className='truncate font-medium text-sm'>{row.name}</span>
                    <span className='text-muted-foreground text-xs'>{row.reason}</span>
                    <span className='text-muted-foreground text-xs'>
                      Now {partKindLabel(row.currentKind)} · suggested{' '}
                      {partKindLabel(row.suggestedKind)}
                    </span>
                  </div>
                  <div className='flex shrink-0 flex-wrap items-center gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      disabled={busy}
                      onClick={() => void keep(row)}>
                      {row.keepLabel}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      loading={busy && busyIds.size === 1}
                      loadingText='Saving...'
                      disabled={busy}
                      onClick={() => void applyKinds([row])}>
                      Make {partKindLabel(row.suggestedKind)}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
      <ConfirmDialog />
    </div>
  )
}
