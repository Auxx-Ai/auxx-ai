// apps/web/src/components/purchasing/intake/ui/intake-lines-table.tsx
'use client'

// The proposed lines (plans/money/tasks/38 §6.2).
//
// The container is written here — header row, the "needs review" chip, the folded
// strip, the keyboard nav — and the ROWS are `DraftLineRow` (see
// `intake-line-row.tsx`). `useLineNav` gives the same spreadsheet rhythm every
// other line surface has; it is pure DOM against `data-line-row` / `data-line-col`
// and couples to nothing.

import {
  type IntakeFold,
  type IntakeLine,
  isAutoLinkTier,
  orderableLines,
  unresolvedLines,
} from '@auxx/lib/purchasing/intake/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Receipt, Truck, Undo2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { PartPrefillResolver } from '~/components/money/ui/line-builder/line-rows'
import { LINE_COLS } from '~/components/money/ui/line-builder/line-rows'
import type { LinePatch } from '~/components/money/ui/line-builder/line-values'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useLineNav } from '~/components/money/ui/line-builder/use-line-nav'
import { foldAmountCents } from '../hooks/use-intake-draft'
import { IntakeLineRow } from './intake-line-row'

interface IntakeLinesTableProps {
  lines: IntakeLine[]
  currency: string
  vendorName: string | null
  resolvePartPrefill?: PartPrefillResolver
  onPatch: (lineId: string, patch: LinePatch) => void
  onChooseBreak: (lineId: string, index: number | null) => void
  onFold: (lineId: string, into: IntakeFold) => void
  onUnfold: (lineId: string) => void
  onRemove: (lineId: string) => void
}

export function IntakeLinesTable({
  lines,
  currency,
  vendorName,
  resolvePartPrefill,
  onPatch,
  onChooseBreak,
  onFold,
  onUnfold,
  onRemove,
}: IntakeLinesTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [onlyReview, setOnlyReview] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const orderable = useMemo(() => orderableLines(lines), [lines])
  const folded = useMemo(() => lines.filter((line) => line.foldedInto !== null), [lines])

  // "Needs review" is broader than "blocks the commit": a `fuzzy` row that
  // somebody has since picked a part for no longer blocks anything, but a row the
  // ladder auto-linked and a row a person confirmed are not the same claim, and
  // the chip is what a person came to a 40-line quote for.
  const needsReview = useMemo(
    () => orderable.filter((line) => line.partRecordId === null || !isAutoLinkTier(line.tier)),
    [orderable]
  )
  const blocking = useMemo(() => unresolvedLines(lines), [lines])

  const visible = onlyReview ? needsReview : orderable

  // 🛑 Nav counts the VISIBLE rows. Filtering to the review set and then telling
  // `useLineNav` there are forty would walk focus onto rows that are not rendered.
  // `colCount` is 4 because a purchase order's amount cell is an input
  // (`amountMode: 'derived-editable'`), matching `line-builder.tsx`.
  useLineNav({
    containerRef,
    rowCount: visible.length,
    colCount: 4,
    onAddRow: () => {},
    readOnly: false,
  })

  const toggleExpanded = (lineId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(lineId)) next.add(lineId)
      return next
    })
  }

  return (
    <div className='flex flex-col'>
      <div className='flex items-center justify-between gap-2 pb-1.5'>
        <div className='flex items-center gap-2'>
          <span className='font-medium text-sm'>Lines</span>
          <span className='text-muted-foreground text-xs'>
            {orderable.length} {orderable.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
        {needsReview.length > 0 && (
          <Button
            variant={onlyReview ? 'outline' : 'ghost'}
            size='xs'
            onClick={() => setOnlyReview((v) => !v)}>
            <Badge variant='amber' size='sm'>
              {needsReview.length}
            </Badge>
            {onlyReview ? 'Showing rows to review' : 'Needs review'}
          </Button>
        )}
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <div
          className='grid border-b bg-muted/40 px-1 py-1.5 font-medium text-muted-foreground text-xs'
          style={{ gridTemplateColumns: LINE_COLS }}>
          <span className='pl-1'>Part</span>
          <span>Qty</span>
          <span>Price</span>
          <span>Total</span>
        </div>

        <div ref={containerRef}>
          {visible.length === 0 ? (
            <p className='p-6 text-center text-muted-foreground text-sm'>
              {onlyReview
                ? 'Every line has a part. Nothing left to review.'
                : 'This quote produced no orderable lines.'}
            </p>
          ) : (
            visible.map((line, index) => (
              <IntakeLineRow
                key={line.lineId}
                line={line}
                rowIndex={index}
                currency={currency}
                vendorName={vendorName}
                resolvePartPrefill={resolvePartPrefill}
                expanded={expanded.has(line.lineId)}
                onToggleExpanded={() => toggleExpanded(line.lineId)}
                onPatch={onPatch}
                onChooseBreak={onChooseBreak}
                onFold={onFold}
                onRemove={onRemove}
              />
            ))
          )}
        </div>
      </div>

      {blocking.length > 0 && (
        <p className='pt-2 text-amber-700 text-xs dark:text-amber-400'>
          {blocking.length} {blocking.length === 1 ? 'line' : 'lines'} still need a part. Pick one,
          create one, or fold the amount into shipping or tax.
        </p>
      )}

      {/* A fold that cannot be seen or reversed is a delete with extra steps. */}
      {folded.length > 0 && (
        <div className='mt-3 flex flex-col gap-1 rounded-lg border border-dashed p-2'>
          <span className='px-1 font-medium text-muted-foreground text-xs'>
            Folded into header totals
          </span>
          {folded.map((line) => (
            <div
              key={line.lineId}
              className='flex items-center gap-2 px-1 py-0.5 text-muted-foreground text-xs'>
              {line.foldedInto === 'shipping' ? (
                <Truck className='size-3.5' />
              ) : (
                <Receipt className='size-3.5' />
              )}
              <span className='truncate'>
                {line.printed.description ?? line.printed.vendorCode ?? 'Unnamed line'}
              </span>
              <span className={cn('ml-auto tabular-nums')}>
                {formatCurrency(foldAmountCents(line, currency), currency)}
              </span>
              <Button variant='ghost' size='icon-xs' onClick={() => onUnfold(line.lineId)}>
                <Undo2 />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
