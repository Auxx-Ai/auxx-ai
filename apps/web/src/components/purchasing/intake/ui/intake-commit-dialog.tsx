// apps/web/src/components/purchasing/intake/ui/intake-commit-dialog.tsx
'use client'

// The one dialog on the review page (plans/money/tasks/38 §6.3).
//
// It summarises the write and carries §5.3's `vendorSku` write-back offer as
// PER-LINE checkboxes, unchecked.
//
// 🛑 Per line, not one blanket toggle. A vendor's printed line code is sometimes
// their order number rather than their part number, and writing that as a
// `vendorSku` poisons every future tier-1 match. The person can tell which is
// which; a single switch forces them to gamble on all of them at once.
//
// 🛑 Unchecked by default is "offer, never silently" — and the write-back is not
// a bonus. `vendor_part_vendor_sku` is empty (4 of 206 rows in the main org), so
// tier 1 only becomes real if confirming a match teaches it.

import type { IntakeDraftPayload, IntakeWriteBack } from '@auxx/lib/purchasing/intake/client'
import { orderableLines } from '@auxx/lib/purchasing/intake/client'
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
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { type RecordId, useRecord } from '~/components/resources'
import { intakeTotals } from './intake-header-panel'

interface IntakeCommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  payload: IntakeDraftPayload
  vendorName: string | null
  fileName: string | null
  isPending: boolean
  onConfirm: (writeBacks: IntakeWriteBack[]) => void
}

export function IntakeCommitDialog({
  open,
  onOpenChange,
  payload,
  vendorName,
  fileName,
  isPending,
  onConfirm,
}: IntakeCommitDialogProps) {
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set())

  const lines = useMemo(() => orderableLines(payload.lines), [payload.lines])
  const totals = useMemo(() => intakeTotals(payload), [payload])

  /**
   * Candidates for a write-back: a resolved part whose printed code is not
   * already what this vendor's catalogue says.
   *
   * `vendor_sku` rows are excluded because the code they matched on IS the
   * catalogue entry — re-writing it teaches nothing.
   */
  const candidates = useMemo(
    () =>
      lines.filter(
        (line) =>
          line.partRecordId !== null &&
          line.tier !== 'vendor_sku' &&
          Boolean(line.printed.vendorCode?.trim())
      ),
    [lines]
  )

  // Reopened dialogs start unchecked. Carrying a previous session's ticks into a
  // fresh open is the one way a blanket accept could happen by accident.
  useEffect(() => {
    if (open) setAccepted(new Set())
  }, [open])

  const toggle = (lineId: string) => {
    setAccepted((current) => {
      const next = new Set(current)
      if (!next.delete(lineId)) next.add(lineId)
      return next
    })
  }

  const handleConfirm = () => {
    const writeBacks: IntakeWriteBack[] = candidates
      .filter((line) => accepted.has(line.lineId))
      .map((line) => ({
        partRecordId: line.partRecordId!,
        vendorSku: line.printed.vendorCode!.trim(),
      }))
    onConfirm(writeBacks)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Create purchase order</DialogTitle>
          <DialogDescription>
            {`Creates a purchase order for ${vendorName ?? 'this vendor'} with ${lines.length} ${
              lines.length === 1 ? 'line' : 'lines'
            }, totalling ${formatCurrency(totals.ours, payload.currency)}, and links the quote as an internal attachment.`}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-3 text-sm'>
          {fileName && (
            <p className='text-muted-foreground text-xs'>
              The attached quote stays internal. Nothing in the order's attachments enters the PDF
              sent to the vendor, so their own quote does not go back to them stapled to our order.
            </p>
          )}

          {candidates.length > 0 && (
            <div className='flex flex-col gap-2 rounded-lg border p-3'>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium'>
                  Teach {vendorName ?? 'this vendor'}&apos;s codes?
                </span>
                <span className='text-muted-foreground text-xs'>
                  Only tick a code that is the vendor&apos;s own part number. Their order-line
                  numbers look the same and would match the wrong part next time.
                </span>
              </div>
              <ul className='flex max-h-56 flex-col gap-1 overflow-y-auto'>
                {candidates.map((line) => (
                  <li key={line.lineId} className='flex items-center gap-2'>
                    <Checkbox
                      id={`writeback-${line.lineId}`}
                      checked={accepted.has(line.lineId)}
                      onCheckedChange={() => toggle(line.lineId)}
                      disabled={isPending}
                    />
                    <label
                      htmlFor={`writeback-${line.lineId}`}
                      className='flex min-w-0 flex-1 items-center gap-2 text-xs'>
                      <span className='font-mono'>{line.printed.vendorCode}</span>
                      <span className='text-muted-foreground'>&rarr;</span>
                      <span className='min-w-0 truncate'>
                        {line.partRecordId ? (
                          <PartLabel
                            recordId={line.partRecordId}
                            fallback={line.description ?? line.printed.description}
                          />
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <span className='text-muted-foreground text-xs'>
                The next quote from {vendorName ?? 'this vendor'} matches the ticked codes
                automatically.
              </span>
            </div>
          )}
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
            variant='outline'
            size='sm'
            onClick={handleConfirm}
            loading={isPending}
            loadingText='Creating...'
            data-dialog-submit>
            Create purchase order <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The part's display name.
 *
 * Falls back to the line's own description rather than to the record id: the
 * checkbox beside it is a decision about which PART a code teaches, and a cuid is
 * not something a person can make that decision against.
 */
function PartLabel({ recordId, fallback }: { recordId: RecordId; fallback: string | null }) {
  const { record } = useRecord({ recordId })
  return <>{record?.displayName ?? fallback ?? 'Selected part'}</>
}
