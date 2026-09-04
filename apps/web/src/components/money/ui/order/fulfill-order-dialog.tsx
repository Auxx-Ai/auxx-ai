// apps/web/src/components/money/ui/order/fulfill-order-dialog.tsx
'use client'

// The Fulfill action (plans/accounting/ui-plan.md §2.3 item 2, tasks/01 phase A).
//
// 🛑 **This is not a status flip.** `money.fulfillOrder` records WHAT shipped,
// per line, and posts `Dr accounts_receivable / Cr revenue + tax + shipping` for
// that shipment. Handoff decision 6.6 chose an action over a field pre-hook on
// `order_fulfillment_status` for exactly this reason: a status flip cannot carry
// quantities, and without quantities a second shipment can only re-recognise the
// whole order.
//
// ## Why this is shaped like `complete-build-dialog.tsx`
//
// Same problem, same answer: an irreversible ledger write driven by quantities a
// person types. So the form shows what it will post, at what total, and what
// would stop it, and it says all three before the button is reachable. The
// preview runs the SAME builder and resolver the write runs
// (`money.previewFulfillment` -> `previewFulfillment` -> `buildFulfillmentEntry`),
// so there is no second implementation of the arithmetic to drift.
//
// ## The refusals are cards, not toasts
//
// Ground rule 9. `EntryBlockers` renders the preview's `blockedBy` at the same
// visual weight as the entry - a locked period, an unmapped revenue role, a
// channel with no account. A toast for any of those is a puzzle rather than a
// task. Only an unexpected mutation failure gets `toastError`.

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { keepPreviousData } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { EntryBlockers } from '~/components/accounting/ui/ledger/entry-blockers'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { useDebounce } from '~/hooks/use-debounced-value'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'

/**
 * How long a typed quantity is held back before it becomes a preview request.
 *
 * Typing `120` is three keystrokes, and without this it is three entries built
 * and three chart resolutions. Only what feeds the query waits - the inputs stay
 * instant, so nothing on screen lags behind the keyboard.
 */
const PREVIEW_DEBOUNCE_MS = 250

interface FulfillOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `EntityInstance.id` of the order being fulfilled. */
  orderId: string
  onFulfilled?: () => void
}

export function FulfillOrderDialog({
  open,
  onOpenChange,
  orderId,
  onFulfilled,
}: FulfillOrderDialogProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [shippedAt, setShippedAt] = useState<string>(() => todayKey())
  const [touched, setTouched] = useState(false)

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const order = api.money.orderForFulfillment.useQuery(
    { orderId },
    { enabled: open, retry: false, refetchOnWindowFocus: false }
  )

  // A fresh form on every open. A stale shipped date left over from a dialog
  // somebody abandoned yesterday would backdate the whole entry, and stale
  // quantities would ship one order's numbers against the next.
  useEffect(() => {
    if (!open) return
    setShippedAt(todayKey())
    setTouched(false)
  }, [open])

  // Prefilled to what remains - most shipments are the rest of the order. Held
  // in a separate effect from the reset above so a refetch does not stomp on
  // what the person has typed.
  useEffect(() => {
    if (!open || touched || !order.data) return
    setQuantities(
      Object.fromEntries(order.data.lines.map((line) => [line.lineId, line.remainingQuantity]))
    )
  }, [open, touched, order.data])

  const shippedLines = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([lineId, quantity]) => ({ lineId, quantity })),
    [quantities]
  )

  const previewLines = useDebounce(shippedLines, PREVIEW_DEBOUNCE_MS)
  const previewDate = useDebounce(shippedAt, PREVIEW_DEBOUNCE_MS)

  // The preview IS the form: it re-runs on every quantity, so what is on screen
  // is always what the write would freeze.
  //
  // 🛑 `keepPreviousData` is load-bearing, not polish. Without it every keystroke
  // changes the query key, `data` goes undefined, and the total, the blockers and
  // the submit button all blank together - which reads as "the numbers just went
  // away" on a form whose write cannot be undone.
  const preview = api.money.previewFulfillment.useQuery(
    { orderId, shippedLines: previewLines, shippedAt: previewDate },
    {
      enabled: open && previewLines.length > 0,
      retry: false,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    }
  )

  /**
   * The numbers on screen do not yet answer the quantities in the inputs.
   *
   * True through the debounce window as well as the request, so the total dims
   * from the first keystroke rather than a beat later, and so the button can
   * refuse a shipment whose entry nobody has actually seen.
   */
  const previewStale =
    preview.isFetching || previewLines !== shippedLines || previewDate !== shippedAt

  const utils = api.useUtils()
  const fulfill = api.money.fulfillOrder.useMutation({
    onError: (error) => toastError({ title: 'Failed to fulfil order', description: error.message }),
  })

  const handleFulfill = async () => {
    if (shippedLines.length === 0) return
    try {
      const result = await fulfill.mutateAsync({ orderId, shippedLines, shippedAt })
      // A ledger refusal is NOT a thrown error - `postEntry` never throws. It
      // arrives here as a status, and the shipment has already been rolled back,
      // so the dialog stays open with the refusal on it rather than closing over
      // a fulfillment that did not happen.
      if (!ACCEPTED_POST_STATUSES.has(result.post.status)) {
        await utils.money.previewFulfillment.invalidate({ orderId })
        return
      }
      await Promise.all([
        utils.money.orderForFulfillment.invalidate({ orderId }),
        utils.money.previewFulfillment.invalidate({ orderId }),
      ])
      onFulfilled?.()
      onOpenChange(false)
    } catch {
      // onError above already surfaced the toast.
    }
  }

  const blockers = useMemo(() => {
    const rows: Array<{ status: string; error: string }> = []
    if (preview.data?.blockedBy) rows.push(preview.data.blockedBy)
    // A refusal returned by the mutation - the ledger would not take the entry
    // and the shipment was rolled back.
    if (fulfill.data && !ACCEPTED_POST_STATUSES.has(fulfill.data.post.status)) {
      rows.push({
        status: fulfill.data.post.status,
        error: fulfill.data.post.error ?? 'The ledger refused this fulfillment.',
      })
    }
    return rows
  }, [preview.data, fulfill.data])

  const nothingLeft = !!order.data && order.data.lines.every((line) => line.remainingQuantity <= 0)
  const canSubmit =
    shippedLines.length > 0 &&
    !previewStale &&
    !preview.data?.blockedBy &&
    !fulfill.isPending &&
    !nothingLeft

  return (
    <Dialog open={open} onOpenChange={(next) => !fulfill.isPending && onOpenChange(next)}>
      <DialogContent size='lg'>
        <DialogHeader>
          <DialogTitle>Fulfil {order.data?.number ?? 'order'}</DialogTitle>
          <DialogDescription>
            Records what shipped and posts the revenue it recognises. Revenue is recognised when
            goods ship, not when the invoice is raised, so this is the entry that reaches the profit
            and loss.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[60vh]' allowScrollChaining>
          <div className='flex flex-col gap-4 pe-2'>
            {order.isPending && <Skeleton className='h-40 w-full' />}
            {order.error && <p className='text-destructive text-sm'>{order.error.message}</p>}

            {order.data && (
              <>
                <FieldPanel className='p-0' breakpoint='md' resizeId='fulfil-order'>
                  <FieldPanelRow
                    title='Shipped on'
                    type={BaseType.DATE}
                    showIcon
                    isRequired
                    description='The accounting date, which is not when it was keyed'>
                    <FieldInputAdapter
                      fieldType={FieldType.DATE}
                      value={shippedAt}
                      onChange={(value) => {
                        setTouched(true)
                        setShippedAt((value as string) ?? todayKey())
                      }}
                      disabled={fulfill.isPending}
                    />
                  </FieldPanelRow>

                  {order.data.lines.map((line) => (
                    <FieldPanelRow
                      key={line.lineId}
                      title={line.name}
                      type={BaseType.NUMBER}
                      showIcon
                      description={
                        line.shippedQuantity > 0
                          ? `${line.remainingQuantity} of ${line.quantity} left (${line.shippedQuantity} already shipped)`
                          : `${line.remainingQuantity} of ${line.quantity} left`
                      }>
                      <FieldInputAdapter
                        fieldType={FieldType.NUMBER}
                        value={quantities[line.lineId] ?? 0}
                        onChange={(value) => {
                          setTouched(true)
                          setQuantities((current) => ({
                            ...current,
                            [line.lineId]: (value as number) ?? 0,
                          }))
                        }}
                        placeholder='0'
                        disabled={fulfill.isPending || line.remainingQuantity <= 0}
                      />
                    </FieldPanelRow>
                  ))}
                </FieldPanel>

                {nothingLeft && (
                  <p className='text-muted-foreground text-sm'>
                    Every line on this order has shipped. There is nothing left to recognise.
                  </p>
                )}

                {/* Dimmed while the figures catch up, never unmounted: a block
                    that disappears reads as "there is no answer", and a person
                    looking at an entry about to post should see the previous
                    answer greying out rather than the space it used to occupy. */}
                {preview.data && !preview.data.blockedBy && (
                  <div
                    className={`space-y-1 rounded-md border p-3 text-xs tabular-nums transition-opacity ${
                      previewStale ? 'opacity-50' : ''
                    }`}>
                    <div className='flex items-baseline justify-between gap-2 font-medium'>
                      <span className='text-muted-foreground'>{preview.data.docNumber}</span>
                      <span>{formatCurrency(preview.data.totalMinor, { currencyCode })}</span>
                    </div>
                    {preview.data.lines.map((entryLine) => (
                      <div
                        key={`${entryLine.accountCode}-${entryLine.sortOrder}`}
                        className='flex items-baseline justify-between gap-2'>
                        <span className='text-muted-foreground'>
                          {entryLine.direction === 'debit' ? 'Dr' : '   Cr'} {entryLine.accountCode}{' '}
                          {entryLine.accountName ?? ''}
                        </span>
                        <span>{formatCurrency(entryLine.amount, { currencyCode })}</span>
                      </div>
                    ))}
                  </div>
                )}

                <EntryBlockers
                  blockers={blockers as Parameters<typeof EntryBlockers>[0]['blockers']}
                />
              </>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={fulfill.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleFulfill}
            disabled={!canSubmit}
            loading={fulfill.isPending}
            loadingText='Posting...'>
            Fulfil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The `postEntry` statuses that mean the ledger took the shipment.
 *
 * `not_connected` and `disabled` are successes: an org with no accounting system
 * connected is a first-class case, not a degraded one - the entry is built,
 * balanced and persisted, it is simply never pushed.
 */
const ACCEPTED_POST_STATUSES = new Set<string>([
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
])

/** `YYYY-MM-DD` for today, in the browser's own zone. */
function todayKey(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
