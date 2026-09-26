// apps/web/src/components/accounting/ui/ledger/outbox/set-costs-dialog.tsx
'use client'

import { PartKind } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { useEffect, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import {
  buildSetCostsRows,
  isBoughtFinishedGood,
  isEditableRow,
  type SetCostsDraft,
  type SetCostsDrafts,
  type SetCostsRow,
  seedSuggestions,
  suggestionSourceLabel,
  toSetCostsItems,
} from './set-costs-rows'

const REASON_CODE = 'STANDARD_COST_MISSING'
/** `setStandardCosts` takes at most this many items per call. */
const SAVE_CHUNK = 500
/** `builds.standardCostWorklist` takes at most this many part ids. */
const WORKLIST_MAX = 5000
const GRID_COLUMNS = 'sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_10rem_8rem] sm:gap-3'

/** What one saved row did; a non-zero revaluation means a moved part was restated. */
interface SavedOutcome {
  revaluationPostedMinor: number
}

interface SetCostsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currencyCode: string
}

/** Every part whose movements wait on a standard cost, and the leaves under the BOM ones (09 D-SC3). */
export function SetCostsDialog({ open, onOpenChange, currencyCode }: SetCostsDialogProps) {
  const utils = api.useUtils()
  const list = api.ledger.listBlocked.useInfiniteQuery(
    { reasonCode: REASON_CODE, limit: 200 },
    { getNextPageParam: (page) => page.nextCursor, enabled: open }
  )
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    if (open && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [open, hasNextPage, isFetchingNextPage, fetchNextPage])
  const groups = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const listLoading = list.isPending || hasNextPage

  // Parts seen blocked while open keep their rows after a save prices them, so a rolled parent shows.
  const [seenIds, setSeenIds] = useState<string[]>([])
  useEffect(() => {
    if (!open) {
      setSeenIds([])
      return
    }
    setSeenIds((current) => {
      const known = new Set(current)
      const added = groups.flatMap((group) =>
        group.externalRef && !known.has(group.externalRef) ? [group.externalRef] : []
      )
      return added.length > 0 ? [...current, ...new Set(added)] : current
    })
  }, [open, groups])

  const worklist = api.builds.standardCostWorklist.useQuery(
    { partIds: seenIds.slice(0, WORKLIST_MAX) },
    {
      enabled: open && !listLoading && seenIds.length > 0,
      placeholderData: (previous) => previous,
    }
  )
  const rows = useMemo(() => buildSetCostsRows(groups, worklist.data), [groups, worklist.data])
  const loading = listLoading || (worklist.isPending && worklist.fetchStatus !== 'idle')

  const [drafts, setDrafts] = useState<SetCostsDrafts>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [outcomes, setOutcomes] = useState<Record<string, SavedOutcome>>({})
  const saved = useMemo(() => new Set(Object.keys(outcomes)), [outcomes])

  useEffect(() => {
    if (!open) return
    setDrafts({})
    setErrors({})
    setOutcomes({})
  }, [open])

  // Suggestions arrive with the worklist; each lands in its row until someone types there.
  useEffect(() => {
    if (open) setDrafts((current) => seedSuggestions(rows, current, currencyCode))
  }, [open, rows, currencyCode])

  const pending = useMemo(
    () => toSetCostsItems(rows, drafts, { currencyCode, skip: saved }),
    [rows, drafts, currencyCode, saved]
  )
  const blockedCount = rows.filter((row) => !row.isLeaf).length
  const leafCount = rows.length - blockedCount
  const waiting = rows.reduce((sum, row) => sum + row.waiting, 0)

  const setStandardCosts = api.builds.setStandardCosts.useMutation({
    onError: (error) => toastError({ title: 'Could not set costs', description: error.message }),
  })

  function edit(partId: string, patch: SetCostsDraft) {
    setDrafts((current) => ({ ...current, [partId]: { ...current[partId], ...patch } }))
    setErrors((current) => {
      if (!(partId in current)) return current
      const { [partId]: _, ...rest } = current
      return rest
    })
  }

  async function save() {
    if (Object.keys(pending.errors).length > 0) {
      setErrors(pending.errors)
      return
    }
    if (pending.items.length === 0) return
    const nextErrors: Record<string, string> = {}
    const nextOutcomes = { ...outcomes }
    let failed = false
    try {
      for (let at = 0; at < pending.items.length; at += SAVE_CHUNK) {
        const results = await setStandardCosts.mutateAsync({
          items: pending.items.slice(at, at + SAVE_CHUNK),
        })
        for (const result of results) {
          if (result.ok) {
            nextOutcomes[result.partId] = {
              revaluationPostedMinor: result.revaluationPostedMinor ?? 0,
            }
          } else nextErrors[result.partId] = result.error ?? 'Could not set this cost'
        }
      }
    } catch {
      // `onError` already said so; rows saved by earlier chunks stay saved.
      failed = true
    }
    setOutcomes(nextOutcomes)
    setErrors(nextErrors)
    void utils.ledger.listBlocked.invalidate()
    void utils.ledger.listBlockedItems.invalidate()
    void utils.ledger.outboxCounts.invalidate()
    void utils.builds.standardCostWorklist.invalidate()
    // Stay open when there is something to read: a restate's revaluation, or parents a leaf rolled.
    const leaves = new Set(rows.filter((row) => row.isLeaf).map((row) => row.partId))
    const worthReading = pending.items.some(
      (item) =>
        nextOutcomes[item.partId] &&
        (leaves.has(item.partId) || nextOutcomes[item.partId]?.revaluationPostedMinor !== 0)
    )
    if (!failed && Object.keys(nextErrors).length === 0 && !worthReading) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='3xl' mobileFullHeight>
        <DialogHeader>
          <DialogTitle>Set costs</DialogTitle>
          <DialogDescription>
            {loading
              ? 'Loading the parts waiting on a standard cost…'
              : `${blockedCount} ${blockedCount === 1 ? 'part' : 'parts'} whose stock movements are waiting to be valued, across ${waiting} ${
                  waiting === 1 ? 'document' : 'documents'
                }${
                  leafCount > 0
                    ? `, and ${leafCount} uncosted ${leafCount === 1 ? 'component' : 'components'} their bills of materials roll from`
                    : ''
                }. Saving values every movement waiting on a part, rolls the parents whose components are all costed, and posts them.`}
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 overflow-y-auto sm:max-h-[60vh]'>
          <div
            className={`${GRID_COLUMNS} hidden border-b px-1 pb-1.5 text-muted-foreground text-xs`}>
            <span>Part</span>
            <span className='text-right'>Waiting</span>
            <span>Unit cost</span>
            <span>Kind</span>
          </div>
          {loading && rows.length === 0
            ? Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className='my-2 h-8 w-full' />
              ))
            : rows.map((row) => (
                <SetCostsGridRow
                  key={row.partId}
                  row={row}
                  draft={drafts[row.partId]}
                  error={errors[row.partId]}
                  outcome={outcomes[row.partId]}
                  currencyCode={currencyCode}
                  onEdit={(patch) => edit(row.partId, patch)}
                />
              ))}
        </div>

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={save}
            disabled={pending.items.length === 0 && Object.keys(pending.errors).length === 0}
            loading={setStandardCosts.isPending}
            loadingText='Saving...'
            data-dialog-submit>
            Save <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SetCostsGridRowProps {
  row: SetCostsRow
  draft: SetCostsDraft | undefined
  error: string | undefined
  outcome: SavedOutcome | undefined
  currencyCode: string
  onEdit: (patch: SetCostsDraft) => void
}

/** One part: a stacked card on mobile, a grid row from `sm` up. */
function SetCostsGridRow({
  row,
  draft,
  error,
  outcome,
  currencyCode,
  onEdit,
}: SetCostsGridRowProps) {
  const kind = draft?.kind ?? row.kind ?? ''
  const service = kind === PartKind.SERVICE
  const editable = isEditableRow(row, draft)
  const saved = outcome !== undefined
  const money = (minor: number) => formatCurrency(minor, { currencyCode })
  const usedIn = row.usedIn > 0 ? `Used in ${row.usedIn}` : null

  return (
    <div className='border-b px-1 py-2 last:border-b-0'>
      <div className={`${GRID_COLUMNS} flex flex-col gap-1.5 sm:items-start`}>
        <span className='flex min-w-0 flex-col pt-1'>
          <span className='truncate font-medium text-sm' title={row.name}>
            {row.name}
          </span>
          {(row.isLeaf || usedIn) && (
            <span className='text-muted-foreground text-xs'>
              {[row.isLeaf ? 'Component' : null, usedIn].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        <span
          className='pt-1.5 text-muted-foreground text-xs tabular-nums sm:text-right'
          title={row.waitingLabel}>
          <span className='sm:hidden'>Waiting: </span>
          {row.waitingLabel}
        </span>
        {editable ? (
          <span className='flex flex-col gap-0.5'>
            <Input
              size='sm'
              inputMode='decimal'
              aria-label={`Unit cost for ${row.name}`}
              placeholder={service ? 'No cost' : '0.00'}
              value={service ? '' : (draft?.unitCost ?? '')}
              disabled={saved || service}
              aria-invalid={!!error}
              className={draft?.suggested ? 'text-muted-foreground' : undefined}
              onChange={(event) => onEdit({ unitCost: event.target.value, suggested: false })}
            />
            {!service && (
              <CostHints row={row} draft={draft} money={money} onEdit={onEdit} saved={saved} />
            )}
          </span>
        ) : (
          <span className='flex flex-col gap-0.5 pt-1 text-sm'>
            {row.standardCost != null ? (
              <span className='tabular-nums'>{money(row.standardCost)}</span>
            ) : (
              <span className='text-muted-foreground text-xs'>
                Rolls from BOM · {row.uncostedLeafCount} uncosted
              </span>
            )}
            {!saved && row.standardCost == null && (
              <Button
                variant='link'
                size='xs'
                className='h-auto justify-start px-0 text-muted-foreground'
                onClick={() => onEdit({ override: true })}>
                Set cost instead
              </Button>
            )}
          </span>
        )}
        <Select
          value={kind || undefined}
          disabled={saved || !editable}
          onValueChange={(value) => onEdit({ kind: value })}>
          <SelectTrigger size='sm' aria-label={`Kind for ${row.name}`}>
            <SelectValue placeholder='Kind' />
          </SelectTrigger>
          <SelectContent>
            {PartKind.values.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {editable && !saved && isBoughtFinishedGood(row, kind) && (
        <p
          className='pt-1 text-muted-foreground text-xs'
          title='Import its BOM first if you build it.'>
          No BOM, costed as bought.
        </p>
      )}
      {error && <p className='pt-1 text-destructive text-xs'>{error}</p>}
      {saved && !error && (
        <p className='pt-1 text-muted-foreground text-xs'>
          {outcome.revaluationPostedMinor !== 0
            ? `Saved · revalued on hand ${outcome.revaluationPostedMinor > 0 ? '+' : ''}${money(outcome.revaluationPostedMinor)}`
            : 'Saved'}
        </p>
      )}
    </div>
  )
}

/** Under the input: the suggestion's source and the other cost, or both on "Set cost instead". */
function CostHints({
  row,
  draft,
  money,
  saved,
  onEdit,
}: {
  row: SetCostsRow
  draft: SetCostsDraft | undefined
  money: (minor: number) => string
  saved: boolean
  onEdit: (patch: SetCostsDraft) => void
}) {
  if (row.hasBom) {
    const hints = [
      row.purchaseCost ? `Supplier: ${money(row.purchaseCost)}` : null,
      row.channelCost ? `Channel: ${money(row.channelCost)}` : null,
    ].filter(Boolean)
    return (
      <span className='flex flex-wrap items-center gap-x-2 text-muted-foreground text-xs'>
        {hints.length > 0 && <span>{hints.join(' · ')}</span>}
        {!saved && (
          <Button
            variant='link'
            size='xs'
            className='h-auto px-0 text-muted-foreground'
            onClick={() => onEdit({ override: false, unitCost: undefined })}>
            Roll from BOM
          </Button>
        )}
      </span>
    )
  }
  const { suggestion } = row
  if (!suggestion) return null
  const other = suggestion.other
  return (
    <span className='text-muted-foreground text-xs'>
      {draft?.suggested && suggestionSourceLabel(suggestion.source)}
      {draft?.suggested && other && ' · '}
      {other && `${other.source === 'supplier' ? 'Supplier' : 'Channel'}: ${money(other.unitCost)}`}
    </span>
  )
}
