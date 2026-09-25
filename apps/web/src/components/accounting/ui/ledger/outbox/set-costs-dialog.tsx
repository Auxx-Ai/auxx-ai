// apps/web/src/components/accounting/ui/ledger/outbox/set-costs-dialog.tsx
'use client'

import { PartKind, type RecordId, toRecordId } from '@auxx/lib/resources/client'
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
import { useResourceProperty } from '~/components/resources'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { api } from '~/trpc/react'
import {
  buildSetCostsRows,
  fillChannelCosts,
  type SetCostsDrafts,
  type SetCostsRow,
  seedChannelCosts,
  toSetCostsItems,
} from './set-costs-rows'

const REASON_CODE = 'STANDARD_COST_MISSING'
const PART_ATTRIBUTES = ['part_channel_cost', 'part_kind'] as const
/** `setStandardCosts` takes at most this many items per call. */
const SAVE_CHUNK = 500
const GRID_COLUMNS = 'sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_6.5rem_7rem_8rem] sm:gap-3'

interface SetCostsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currencyCode: string
}

/** Every part whose movements wait on a standard cost, set in one save (106 §6.2, 111 Q18). */
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

  const partDefId = useResourceProperty('part', 'id')
  const recordIds = useMemo(
    () =>
      partDefId
        ? groups.flatMap((group) =>
            group.externalRef ? [toRecordId(partDefId, group.externalRef)] : []
          )
        : [],
    [partDefId, groups]
  )
  const { valuesById } = useSystemValuesForRecords(recordIds, PART_ATTRIBUTES, {
    autoFetch: true,
    enabled: open && recordIds.length > 0,
  })
  const rows = useMemo(() => {
    const byPart: Record<string, Record<string, unknown> | undefined> = {}
    if (partDefId) {
      for (const group of groups) {
        if (!group.externalRef) continue
        byPart[group.externalRef] = valuesById[toRecordId(partDefId, group.externalRef) as RecordId]
      }
    }
    return buildSetCostsRows(groups, byPart)
  }, [groups, partDefId, valuesById])

  const [drafts, setDrafts] = useState<SetCostsDrafts>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!open) return
    setDrafts({})
    setErrors({})
    setSaved(new Set())
  }, [open])

  // Channel costs arrive after the rows; each lands in its row until someone types there.
  useEffect(() => {
    setDrafts((current) => seedChannelCosts(rows, current, currencyCode))
  }, [rows, currencyCode])

  const pending = useMemo(
    () => toSetCostsItems(rows, drafts, { currencyCode, skip: saved }),
    [rows, drafts, currencyCode, saved]
  )
  const canFill = fillChannelCosts(rows, drafts, currencyCode) !== drafts
  const loading = list.isPending || hasNextPage
  const waiting = rows.reduce((sum, row) => sum + row.waiting, 0)

  const setStandardCosts = api.builds.setStandardCosts.useMutation({
    onError: (error) => toastError({ title: 'Could not set costs', description: error.message }),
  })

  function edit(partId: string, patch: { unitCost?: string; kind?: string }) {
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
    const nextSaved = new Set(saved)
    let failed = false
    try {
      for (let at = 0; at < pending.items.length; at += SAVE_CHUNK) {
        const results = await setStandardCosts.mutateAsync({
          items: pending.items.slice(at, at + SAVE_CHUNK),
        })
        for (const result of results) {
          if (result.ok) nextSaved.add(result.partId)
          else nextErrors[result.partId] = result.error ?? 'Could not set this cost'
        }
      }
    } catch {
      // `onError` already said so; rows saved by earlier chunks stay saved.
      failed = true
    }
    setSaved(nextSaved)
    setErrors(nextErrors)
    void utils.ledger.listBlocked.invalidate()
    void utils.ledger.listBlockedItems.invalidate()
    void utils.ledger.outboxCounts.invalidate()
    if (!failed && Object.keys(nextErrors).length === 0) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='3xl' mobileFullHeight>
        <DialogHeader>
          <DialogTitle>Set costs</DialogTitle>
          <DialogDescription>
            {loading
              ? 'Loading the parts waiting on a standard cost…'
              : `${rows.length} ${rows.length === 1 ? 'part' : 'parts'} whose stock movements are waiting to be valued, across ${waiting} ${
                  waiting === 1 ? 'document' : 'documents'
                }. Saving values every movement waiting on a part and posts them.`}
          </DialogDescription>
        </DialogHeader>

        <div className='flex justify-end'>
          <Button
            variant='outline'
            size='sm'
            disabled={!canFill}
            onClick={() => setDrafts((current) => fillChannelCosts(rows, current, currencyCode))}>
            Use channel costs
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto sm:max-h-[60vh]'>
          <div
            className={`${GRID_COLUMNS} hidden border-b px-1 pb-1.5 text-muted-foreground text-xs`}>
            <span>Part</span>
            <span className='text-right'>Waiting</span>
            <span className='text-right'>Channel cost</span>
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
                  unitCost={drafts[row.partId]?.unitCost ?? ''}
                  kind={drafts[row.partId]?.kind ?? row.kind ?? ''}
                  error={errors[row.partId]}
                  saved={saved.has(row.partId)}
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
  unitCost: string
  kind: string
  error: string | undefined
  saved: boolean
  currencyCode: string
  onEdit: (patch: { unitCost?: string; kind?: string }) => void
}

/** One part: a stacked card on mobile, a grid row from `sm` up. */
function SetCostsGridRow({
  row,
  unitCost,
  kind,
  error,
  saved,
  currencyCode,
  onEdit,
}: SetCostsGridRowProps) {
  const service = kind === PartKind.SERVICE
  return (
    <div className='border-b px-1 py-2 last:border-b-0'>
      <div className={`${GRID_COLUMNS} flex flex-col gap-1.5 sm:items-center`}>
        <span className='truncate font-medium text-sm' title={row.name}>
          {row.name}
        </span>
        <span
          className='text-muted-foreground text-xs tabular-nums sm:text-right'
          title={row.waitingLabel}>
          <span className='sm:hidden'>Waiting: </span>
          {row.waitingLabel}
        </span>
        <span className='text-muted-foreground text-xs tabular-nums sm:text-right sm:text-sm'>
          <span className='sm:hidden'>Channel cost: </span>
          {row.channelCost === null ? '-' : formatCurrency(row.channelCost, { currencyCode })}
        </span>
        <Input
          size='sm'
          inputMode='decimal'
          aria-label={`Unit cost for ${row.name}`}
          placeholder={service ? 'No cost' : '0.00'}
          value={service ? '' : unitCost}
          disabled={saved || service}
          aria-invalid={!!error}
          onChange={(event) => onEdit({ unitCost: event.target.value })}
        />
        <Select
          value={kind || undefined}
          disabled={saved}
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
      {error && <p className='pt-1 text-destructive text-xs'>{error}</p>}
      {saved && !error && <p className='pt-1 text-muted-foreground text-xs'>Saved</p>}
    </div>
  )
}
