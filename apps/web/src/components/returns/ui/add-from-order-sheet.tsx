// apps/web/src/components/returns/ui/add-from-order-sheet.tsx
'use client'

// "Add from order" (plans/money/tasks/56-return-lines-on-the-line-grid.md
// §4.6): the bulk door beside the return lines card's hand-added drafts.
// Lists the order's sold lines through `return.returnableLines` (the read
// behind `readReturnableLinesForOrder`, `packages/lib/src/returns/returnable-lines.ts`)
// and commits the checked ones through ONE `record.createMany` round trip,
// the same bundle path the line-builder's catalog-group explode uses.
//
// `ceilingSource: 'unknown'` renders "never shipped, no ceiling recorded"
// (see {@link ledgerText}) and STAYS SELECTABLE, never zero, never blocked.
// That is the de-dup regression plan 54 fixed; re-introducing a block here
// would bring it back.
// A line with `remaining === 0` renders "none left" in the warning color but
// also stays selectable: the server refuses an over-return, this surface only
// warns.

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
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
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { useEffect, useMemo, useState } from 'react'
import { type RecordId, toRecordId } from '~/components/resources/store'
import { api, type RouterOutputs } from '~/trpc/react'

type ReturnableLine = RouterOutputs['return']['returnableLines'][number]

export interface AddFromOrderSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The host return: every created line is preset onto `return_line_return`. */
  returnRecordId: RecordId
  /** The order whose sold lines are on offer. */
  orderRecordId: RecordId
  /** `return_line`'s EntityDefinition id. */
  entityDefinitionId: string
  /** Fired once the batch commits: the card invalidates its lists off this. */
  onAdded: () => void
}

/** The ledger line under a sold line's name: never a claim of zero when the source is unknown. */
function ledgerText(line: ReturnableLine): { text: string; warn: boolean } {
  if (line.ceilingSource === 'unknown') {
    return { text: 'never shipped · no ceiling recorded', warn: false }
  }
  const verb = line.ceilingSource === 'sold' ? 'sold' : 'shipped'
  const ceiling = line.ceiling ?? 0
  const remaining = line.remaining ?? 0
  const tail = remaining === 0 ? 'none left' : `${remaining} left`
  return {
    text: `${ceiling} ${verb} · ${line.alreadyReturned} already back · ${tail}`,
    warn: remaining === 0,
  }
}

/** A whole-number quantity, or the fallback when the typed text does not parse. */
function parseQuantity(raw: string, fallback: number): number {
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * A sheet listing an order's sold lines, each pickable and quantity-editable,
 * committed as one batch of `return_line`s.
 */
export function AddFromOrderSheet({
  open,
  onOpenChange,
  returnRecordId,
  orderRecordId,
  entityDefinitionId,
  onAdded,
}: AddFromOrderSheetProps) {
  const { data, isLoading } = api.return.returnableLines.useQuery(
    { orderRecordId },
    { enabled: open }
  )
  const lines = useMemo(() => data ?? [], [data])

  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({})

  // Fresh selection every time the sheet opens: nothing carries over from a
  // prior visit.
  useEffect(() => {
    if (open) {
      setSelected({})
      setQuantityDrafts({})
    }
  }, [open])

  const { mutateAsync: createManyMutateAsync, isPending } = api.record.createMany.useMutation()

  const selectedCount = useMemo(
    () => lines.filter((line) => line.partId && selected[line.lineItemId]).length,
    [lines, selected]
  )

  const handleAdd = async () => {
    const chosen = lines.filter((line) => line.partId && selected[line.lineItemId])
    if (chosen.length === 0) return

    const records = chosen.map((line) => {
      const fallback = line.remaining ?? 1
      const quantity = parseQuantity(quantityDrafts[line.lineItemId] ?? '', fallback)
      const values: Record<string, unknown> = {
        return_line_return: returnRecordId,
        // Non-null asserted by the `chosen` filter above.
        return_line_part: toRecordId('part', line.partId as string),
        return_line_line_item: line.recordId,
        return_line_quantity: quantity,
      }
      return values
    })

    try {
      await createManyMutateAsync({ entityDefinitionId, records })
      onAdded()
      onOpenChange(false)
    } catch (error) {
      toastError({
        title: 'Error adding lines',
        description: error instanceof Error ? error.message : 'Could not add the lines',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='lg' position='tc'>
        <DialogHeader>
          <DialogTitle>Add from order</DialogTitle>
          <DialogDescription>
            Pick which sold lines came back, and how many of each.
          </DialogDescription>
        </DialogHeader>

        <div className='flex max-h-[24rem] flex-col gap-1 overflow-y-auto'>
          {isLoading && <p className='py-4 text-center text-muted-foreground text-sm'>Loading…</p>}
          {!isLoading && lines.length === 0 && (
            <p className='py-4 text-center text-muted-foreground text-sm'>
              This order has no sold lines to offer.
            </p>
          )}
          {lines.map((line) => {
            const hasPart = !!line.partId
            const ledger = ledgerText(line)
            const fallback = line.remaining ?? 1
            const quantityValue = quantityDrafts[line.lineItemId] ?? String(fallback)
            const checked = hasPart && !!selected[line.lineItemId]
            return (
              <div
                key={line.lineItemId}
                className='flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:bg-primary-50 dark:hover:bg-background'>
                <Checkbox
                  checked={checked}
                  disabled={!hasPart}
                  onCheckedChange={(next) =>
                    setSelected((prev) => ({ ...prev, [line.lineItemId]: next === true }))
                  }
                  aria-label={`Select ${line.name ?? line.partName ?? 'line'}`}
                />
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm'>
                    {line.name ?? line.partName ?? 'Untitled line'}
                  </p>
                  {hasPart ? (
                    <p
                      className={cn(
                        'text-xs tabular-nums',
                        ledger.warn ? 'text-warning-600' : 'text-muted-foreground'
                      )}>
                      {ledger.text}
                    </p>
                  ) : (
                    <p className='text-warning-600 text-xs'>
                      No part on this line, cannot be added
                    </p>
                  )}
                </div>
                <Input
                  size='sm'
                  inputMode='numeric'
                  className='w-16 text-right tabular-nums'
                  disabled={!hasPart}
                  value={quantityValue}
                  onChange={(event) =>
                    setQuantityDrafts((prev) => ({
                      ...prev,
                      [line.lineItemId]: event.target.value,
                    }))
                  }
                  aria-label={`Quantity for ${line.name ?? line.partName ?? 'line'}`}
                />
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleAdd}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Adding...'
            disabled={selectedCount === 0}
            data-dialog-submit>
            Add {selectedCount} line{selectedCount === 1 ? '' : 's'}{' '}
            <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AddFromOrderSheet
