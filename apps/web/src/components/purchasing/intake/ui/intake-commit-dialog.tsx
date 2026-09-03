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
//
// 🛑 **Each row says whether it CREATES a catalogue entry or only adds a code to
// one.** They are not the same act. A `(part, supplier)` pair that already has a
// `vendor_part` gets one field set on a row that was already there; a pair with
// none gets a brand-new `vendor_part` — a catalogue entry that then takes part in
// price prefills, preferred-vendor reads and part-cost recalculation, and that
// nothing on this screen asked for. Behind one unlabelled checkbox the larger of
// the two outcomes is the invisible one.
//
// ⚠️ Which case a row is in is read FRESH from the server when the dialog opens,
// not taken from the draft's stored `vendorPartRecordId`. A part can be picked
// before a vendor is chosen (no prefill runs), and the vendor can be changed
// after the parts were picked (no prefill re-runs), so the stored link can name
// a different supplier's row. A label that can lie about this is worse than none.

import type { IntakeDraftPayload, IntakeWriteBack } from '@auxx/lib/purchasing/intake/client'
import { orderableLines } from '@auxx/lib/purchasing/intake/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Switch } from '@auxx/ui/components/switch'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowRight, Loader2, PackagePlus, Tag, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { type RecordId, useRecord } from '~/components/resources'
import { api } from '~/trpc/react'
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

  const vendorInstanceId = payload.vendorRecordId
    ? parseRecordId(payload.vendorRecordId).entityInstanceId
    : null

  const partInstanceIds = useMemo(
    () =>
      candidates
        .map((line) =>
          line.partRecordId ? parseRecordId(line.partRecordId).entityInstanceId : null
        )
        .filter((id): id is string => id !== null),
    [candidates]
  )

  // Only while the dialog is open: the answer is a fact about the catalogue at
  // decision time, and prefetching it on every review-screen visit would read
  // for a dialog most visits never open.
  const existing = api.purchasing.vendorPartsForParts.useQuery(
    { vendorInstanceId: vendorInstanceId ?? '', partInstanceIds },
    { enabled: open && !!vendorInstanceId && partInstanceIds.length > 0, retry: false }
  )

  const existingParts = useMemo(
    () => new Set(existing.data?.existingPartInstanceIds ?? []),
    [existing.data]
  )

  /** `true` = this tick CREATES a `vendor_part`. `null` = not known yet. */
  const createsEntry = (partRecordId: RecordId): boolean | null => {
    if (!existing.data) return null
    return !existingParts.has(parseRecordId(partRecordId).entityInstanceId)
  }

  const acceptedCreates = candidates.filter(
    (line) => accepted.has(line.lineId) && line.partRecordId && createsEntry(line.partRecordId)
  ).length

  const allAccepted = candidates.length > 0 && accepted.size === candidates.length

  /**
   * Tick or untick every row at once.
   *
   * ⚠️ A convenience, and deliberately NOT the same thing §5.3 refuses. What that
   * rules out is a single control that decides for the person — one blanket
   * switch, or any default that is on. This starts off, is an explicit act, and
   * leaves every per-row switch live to undo one of them. The warning above it
   * and the per-row `New vendor part` badges are still what the decision is made
   * on; forcing forty individual clicks to reach a state somebody has already
   * decided on does not make them read it again.
   */
  const toggleAll = (next: boolean) =>
    setAccepted(next ? new Set(candidates.map((line) => line.lineId)) : new Set())

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
            <>
              {/* The ask, closed. It is a question with a warning attached, and
                  the rows below are the answers — boxing all three together made
                  the warning read as a caption on the list. */}
              <div className='flex flex-col gap-0.5 rounded-2xl border p-3'>
                <span className='font-medium'>
                  Teach {vendorName ?? 'this vendor'}&apos;s codes?
                </span>
                <span className='text-muted-foreground text-xs'>
                  Only tick a code that is the vendor&apos;s own part number. Their order-line
                  numbers look the same and would match the wrong part next time.
                </span>
              </div>

              <div className='flex items-center justify-between gap-2 px-1'>
                <span className='text-muted-foreground text-xs'>
                  {accepted.size} of {candidates.length} selected
                </span>
                <ButtonSwitch
                  label='Select all'
                  size='xs'
                  checked={allAccepted}
                  onCheckedChange={toggleAll}
                  disabled={isPending}
                />
              </div>

              {/* Unboxed, so the rows carry their own surface.
                  `pr-3` on the viewport: the scrollbar is an overlay, and without
                  the gutter it sits on top of the switch it is scrolling past. */}
              <ScrollArea noFade viewportClassName='max-h-56 pr-3' scrollbarClassName='w-1'>
                <TreeRowList
                  items={candidates}
                  getKey={(line) => line.lineId}
                  className={cn('gap-0.5', TREE_SECONDARY_NOTRUNCATE)}
                  renderRow={(line) => {
                    const creates = line.partRecordId ? createsEntry(line.partRecordId) : null
                    const checked = accepted.has(line.lineId)
                    return (
                      <TreeRow
                        icon={
                          creates ? <PackagePlus className='size-4' /> : <Tag className='size-4' />
                        }
                        title={<span className='font-mono text-xs'>{line.printed.vendorCode}</span>}
                        secondary={
                          <span className='flex items-center gap-1 text-xs'>
                            <ArrowRight className='size-3 shrink-0' />
                            {line.partRecordId ? (
                              <PartLabel
                                recordId={line.partRecordId}
                                fallback={line.description ?? line.printed.description}
                              />
                            ) : null}
                          </span>
                        }
                        secondaryFill
                        // The whole row flips the switch — an `xs` thumb is 8px, not
                        // a hit target for a decision this consequential.
                        onToggleOpen={isPending ? undefined : () => toggle(line.lineId)}
                        rowClassName={cn(
                          'cursor-pointer bg-primary-50 hover:bg-primary-100',
                          checked && 'bg-primary-100 hover:bg-primary-150'
                        )}
                        trailing={
                          <div className='flex items-center gap-2'>
                            {/* 🛑 BOTH cases are labelled, not just the loud one.
                                An earlier cut badged only the creates and let the
                                updates say nothing — but absence is not a signal
                                you can read: a list where every row happens to be
                                a create looks exactly like a list where the check
                                never ran. The contrast is the information. */}
                            {creates === true && (
                              <Badge variant='amber' size='xs'>
                                New vendor part
                              </Badge>
                            )}
                            {creates === false && (
                              <Badge variant='gray' size='xs'>
                                Adds code
                              </Badge>
                            )}
                            {/* Not text: the badge slot has a fixed size and a
                                word swapping in and out of it reflows the row as
                                the check lands. An icon in the action slot holds
                                the space and says the same thing in the tooltip. */}
                            {creates === null && (
                              <TreeRowButton
                                persistent
                                tabIndex={-1}
                                tooltipText={
                                  existing.isFetching
                                    ? 'Checking whether this vendor already has a catalogue entry for this part'
                                    : 'Could not check whether this creates a new vendor part. Ticking it still works — the commit decides for itself.'
                                }>
                                {existing.isFetching ? (
                                  <Loader2 className='animate-spin' />
                                ) : (
                                  <TriangleAlert />
                                )}
                              </TreeRowButton>
                            )}
                            <Switch
                              size='xs'
                              checked={checked}
                              onCheckedChange={() => toggle(line.lineId)}
                              disabled={isPending}
                            />
                          </div>
                        }
                      />
                    )
                  }}
                />
              </ScrollArea>

              {/* What ticking them buys, closed separately: it is the consequence
                  of the answers, not part of the question. */}
              <div className='rounded-2xl border p-3 text-muted-foreground text-xs'>
                The next quote from {vendorName ?? 'this vendor'} matches the ticked codes
                automatically.
                {acceptedCreates > 0 &&
                  ` ${acceptedCreates} of them ${
                    acceptedCreates === 1 ? 'creates a' : 'create'
                  } new catalogue ${acceptedCreates === 1 ? 'entry' : 'entries'} for ${
                    vendorName ?? 'this vendor'
                  }.`}
              </div>
            </>
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
