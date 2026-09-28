// apps/web/src/components/manufacturing/stock-setup/check-kinds-step.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isPartKindUnclassified } from '~/components/drawers/cards/part-family-suggestion'
import {
  type OpeningStockKind,
  partKindLabel,
  toOpeningStockKind,
} from '~/components/manufacturing/hooks/use-opening-stock'
import { useConfirm } from '~/hooks/use-confirm'
import { api, type RouterOutputs } from '~/trpc/react'
import { booksStartLabel, useAccountingSetupState } from './accounting-status-line'

type KindConflict = RouterOutputs['builds']['kindConflicts'][number]

interface KindRow {
  partId: string
  name: string
  currentKind: string | null
  suggestedKind: OpeningStockKind
  /** Why the kind looks wrong, in plain words. */
  reason: string
  /** Label of the "this kind is intended" action; conflicts only (17 D3). */
  keepLabel: string | null
}

function listNames(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

function conflictRow(conflict: KindConflict): KindRow {
  const suggestedKind = toOpeningStockKind(conflict.suggestedKind) ?? 'component'
  const suggested = partKindLabel(suggestedKind)
  const reason =
    conflict.reason === 'component_with_bom'
      ? `Has its own parts list, but marked Component. Parts built from other parts are usually ${suggested}s.`
      : `Used inside ${listNames(conflict.usedIn.map((p) => p.partName ?? p.partId)) || 'another part'}, but marked Finished Good. Parts used inside another part are usually ${suggested}s.`
  return {
    partId: conflict.partId,
    name: conflict.partName ?? conflict.partId,
    currentKind: conflict.kind,
    suggestedKind,
    reason,
    keepLabel: conflict.reason === 'finished_good_in_bom' ? 'Sold as-is too, keep it' : 'Keep it',
  }
}

interface CheckKindsStepProps {
  onChanged: () => void
}

/** Step 1 (plans/mrp/17 §5.1): parts whose kind is unconfirmed or contradicts their BOM. */
export function CheckKindsStep({ onChanged }: CheckKindsStepProps) {
  const utils = api.useUtils()
  const accounting = useAccountingSetupState()
  const conflicts = api.builds.kindConflicts.useQuery({})
  const candidates = api.purchasing.listOpeningStockCandidates.useQuery()
  const setKind = api.purchasing.bulkSetPartKind.useMutation()
  const keepKind = api.builds.confirmKindConflicts.useMutation()
  const [confirm, ConfirmDialog] = useConfirm()
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const rows = useMemo<KindRow[]>(() => {
    const conflictRows = (conflicts.data ?? []).map(conflictRow)
    const seen = new Set(conflictRows.map((row) => row.partId))
    // The Set counts suggestion: sold as a product, inside nothing, still on the default kind.
    const unconfirmed = (candidates.data ?? [])
      .filter(
        (c) =>
          !seen.has(c.partId) &&
          c.hasProduct &&
          !c.isSubpartOfAssembly &&
          isPartKindUnclassified(c.partKind)
      )
      .map<KindRow>((c) => ({
        partId: c.partId,
        name: c.title || c.sku || c.partId,
        currentKind: toOpeningStockKind(c.partKind),
        suggestedKind: 'finished_good',
        reason:
          'Sold as a product and used inside nothing, but marked Component. Parts sold as they are are usually Finished Goods.',
        keepLabel: null,
      }))
    return [...conflictRows, ...unconfirmed]
  }, [conflicts.data, candidates.data])

  const refresh = () => {
    void utils.builds.kindConflicts.invalidate()
    void utils.purchasing.listOpeningStockCandidates.invalidate()
    onChanged()
  }

  const withBusy = async (partIds: string[], work: () => Promise<void>) => {
    setBusyIds((prev) => new Set([...prev, ...partIds]))
    try {
      await work()
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev)
        for (const id of partIds) next.delete(id)
        return next
      })
      refresh()
    }
  }

  /** Writes each suggested kind, one call per kind. */
  const applyKinds = (target: KindRow[]) =>
    withBusy(
      target.map((row) => row.partId),
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
    withBusy([row.partId], async () => {
      try {
        await keepKind.mutateAsync({ partIds: [row.partId] })
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
            Movements from {booksStartLabel(accounting.cutoffPeriod)} on post to this part's
            account.
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
                    {row.keepLabel && (
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={busy}
                        onClick={() => void keep(row)}>
                        {row.keepLabel}
                      </Button>
                    )}
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
