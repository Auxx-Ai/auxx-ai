// apps/web/src/components/money/ui/invoice/gather-invoice-dialog.tsx
'use client'

// Work-order "Create invoice" gather dialog (money MI1 build spec §J.5) — a
// bespoke selectable list, NOT a LineBuilder embed (the builder is a
// virtualized inline-editing table, the wrong tool for a pick-list in a
// dialog; logged as a build-spec decision in 01-ui.md). Lines come from
// `money.listUninvoicedLines`, split into the two build-spec groups, all
// pre-checked (decision 7 — unchecking leaves a line for the next gather).
//
// Running total: computed client-side with `computeDocumentTotals` from
// `@auxx/lib/money/client` over the checked lines, but with NO billing inputs
// (no discount/tax) — this dialog only has the work order's raw lines, not
// the quote-snapshot-or-default-rate billing inheritance §G.3 applies when
// the invoice is actually created server-side. Labeling it "Estimated total"
// keeps that honest: the real invoice total (after tax) may differ slightly.

import { computeDocumentTotals, type LineForTotals } from '@auxx/lib/money/client'
import type { RecordId } from '@auxx/types/resource'
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
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import { useSettings } from '~/hooks/use-settings'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { formatCurrency } from '../line-builder/shared'

type UninvoicedLine = RouterOutputs['money']['listUninvoicedLines'][number]

interface GatherInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrderRecordId: RecordId
}

export function GatherInvoiceDialog({
  open,
  onOpenChange,
  workOrderRecordId,
}: GatherInvoiceDialogProps) {
  const router = useRouter()
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const [checkedIds, setCheckedIds] = useState<Set<RecordId>>(new Set())
  const [initialized, setInitialized] = useState(false)

  const { data, isLoading, isError, error } = api.money.listUninvoicedLines.useQuery(
    { workOrderRecordId },
    { enabled: open }
  )
  const lines = useMemo(() => data ?? [], [data])

  // Reset the pre-checked state each time the dialog opens (once the first
  // fetch for this session has landed) — subsequent refetches don't clobber
  // the user's unchecks.
  useEffect(() => {
    if (!open) {
      setInitialized(false)
      return
    }
    if (!initialized && data) {
      setCheckedIds(new Set(data.map((line) => line.recordId)))
      setInitialized(true)
    }
  }, [open, initialized, data])

  useEffect(() => {
    if (isError) {
      toastError({ title: 'Error loading uninvoiced lines', description: error.message })
    }
  }, [isError, error])

  const toggleLine = (recordId: RecordId) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  const jobSetLines = useMemo(() => lines.filter((line) => !line.visitId), [lines])
  const visitExtraLines = useMemo(() => lines.filter((line) => line.visitId), [lines])
  const checkedLines = useMemo(
    () => lines.filter((line) => checkedIds.has(line.recordId)),
    [lines, checkedIds]
  )

  const totals = computeDocumentTotals(
    checkedLines.map(
      (line): LineForTotals => ({ lineTotal: line.lineTotal, taxable: line.taxable })
    ),
    {}
  )

  const createInvoice = api.money.createInvoiceFromWorkOrder.useMutation({
    onSuccess: (result) => {
      onOpenChange(false)
      router.push(`/app/invoices?id=${result.instanceId}`)
    },
    onError: (mutationError) => {
      toastError({ title: 'Error creating invoice', description: mutationError.message })
    },
  })

  const handleCreate = () => {
    if (checkedLines.length === 0) return
    createInvoice.mutate({
      workOrderRecordId,
      lineRecordIds: checkedLines.map((line) => line.recordId),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='lg'>
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
          <DialogDescription>
            Every line starts checked — uncheck any to leave it for a later invoice.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex justify-center py-8'>
            <LoadingSpinner />
          </div>
        ) : lines.length === 0 ? (
          <div className='py-8 text-center text-sm text-muted-foreground'>
            <p>No uninvoiced lines on this job.</p>
            <p className='mt-1 text-xs'>Visit extras appear here once they're added.</p>
          </div>
        ) : (
          <ScrollArea viewportClassName='max-h-[24rem]'>
            <div className='space-y-4 pr-2'>
              {jobSetLines.length > 0 && (
                <LineGroup
                  title='Job set'
                  lines={jobSetLines}
                  checkedIds={checkedIds}
                  currencyCode={currencyCode}
                  onToggle={toggleLine}
                />
              )}
              {visitExtraLines.length > 0 && (
                <LineGroup
                  title='Visit extras'
                  lines={visitExtraLines}
                  checkedIds={checkedIds}
                  currencyCode={currencyCode}
                  onToggle={toggleLine}
                />
              )}
            </div>
          </ScrollArea>
        )}

        {lines.length > 0 && (
          <div className='flex items-center justify-between border-primary-200/50 border-t pt-3 text-sm dark:border-[#1e2227]'>
            <span className='text-muted-foreground'>
              Estimated total ({checkedLines.length} of {lines.length} selected)
            </span>
            <span className='font-medium tabular-nums'>
              {formatCurrency(totals.subtotal, currencyCode)}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={createInvoice.isPending}
            loadingText='Creating...'
            disabled={checkedLines.length === 0}
            onClick={handleCreate}
            data-dialog-submit>
            Create invoice ({checkedLines.length} lines) <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LineGroup({
  title,
  lines,
  checkedIds,
  currencyCode,
  onToggle,
}: {
  title: string
  lines: UninvoicedLine[]
  checkedIds: Set<RecordId>
  currencyCode: string
  onToggle: (recordId: RecordId) => void
}) {
  return (
    <div>
      <div className='px-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
        {title}
      </div>
      <div className='space-y-0.5'>
        {lines.map((line) => (
          <label
            key={line.recordId}
            className='flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-primary-100/40'>
            <Checkbox
              checked={checkedIds.has(line.recordId)}
              onCheckedChange={() => onToggle(line.recordId)}
            />
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm'>{line.name}</div>
              {line.description && (
                <div className='truncate text-muted-foreground text-xs'>{line.description}</div>
              )}
            </div>
            <div className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {line.qty} × {formatCurrency(line.unitPrice, currencyCode)}
            </div>
            <div className='w-20 shrink-0 text-right text-sm tabular-nums'>
              {formatCurrency(line.lineTotal, currencyCode)}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
