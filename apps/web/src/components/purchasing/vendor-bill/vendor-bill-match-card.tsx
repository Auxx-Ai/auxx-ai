// apps/web/src/components/purchasing/vendor-bill/vendor-bill-match-card.tsx
'use client'

// The vendor bill drawer's Overview "Match" card — the `vendor_bill:match` entry
// of `drawer-config.ts`, and the whole of the exception UI
// (plans/purchasing/01-build-plan.md §6.3):
//
//   "Three numbers side by side per line — billed, received, expected — is the
//    entire UI."
//
// So that is what this renders, and nothing more. Each row puts the quantity the
// vendor billed next to the quantity actually received, and the price they
// charged next to the price that was agreed, with the money variance at the end.
// A human reading one row can name the failure — paid for what never arrived, or
// a price nobody agreed — which is the point of the three-way match.
//
// What this card deliberately does NOT do is decide the outcome. Tolerances live
// in `matchBill` (phase 5) and are settings, not code; the verdict this card
// shows is the STORED `vendor_bill_status` / `matchVariance` / `matchNotes` the
// hook wrote. Re-deriving pass/fail on the client with guessed tolerances would
// produce a second, disagreeing answer on the same screen.
//
// The "Match" section title is rendered by the drawer's `TabCardSection` wrapper,
// so this card must not draw one.

import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { ScanSearch } from 'lucide-react'
import { useMemo } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useVendorBillLines, type VendorBillLineValues } from './use-vendor-bill-lines'

/** The bill-level verdict, written by the match hook. */
const BILL_MATCH_ATTRIBUTES = [
  'vendor_bill_currency',
  'vendor_bill_status',
  'vendor_bill_match_variance',
  'vendor_bill_match_notes',
] as const

/** The two legs of the match that live on the purchase order line. */
const PO_LINE_MATCH_ATTRIBUTES = [
  'purchase_order_line_quantity_received',
  'purchase_order_line_expected_unit_price',
] as const

/** Statuses worth a badge — `draft` is the default, so it is not one. */
const STATUS_BADGE: Record<string, { label: string; variant: 'green' | 'amber' | 'red' }> = {
  matched: { label: 'Matched', variant: 'green' },
  exception: { label: 'Exception', variant: 'red' },
  posted: { label: 'Posted', variant: 'green' },
  paid: { label: 'Paid', variant: 'green' },
  void: { label: 'Void', variant: 'amber' },
}

/** SINGLE_SELECT reads come back as arrays; everything else as a scalar. */
function firstValue(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value : undefined
}

function toNumber(raw: unknown): number | null {
  return typeof raw === 'number' ? raw : null
}

function formatQuantity(value: number | null): string {
  return value === null ? '—' : String(value)
}

function formatMoney(value: number | null, currencyCode: string): string {
  return value === null ? '—' : formatCurrency(value, { currencyCode })
}

/** Signed money, so an over-billed line reads `+$12.40` rather than `$12.40`. */
function formatSignedMoney(value: number | null, currencyCode: string): string {
  if (value === null) return '—'
  const formatted = formatCurrency(Math.abs(value), { currencyCode })
  if (value === 0) return formatted
  return `${value > 0 ? '+' : '-'}${formatted}`
}

/** One row's three numbers, plus what they imply. */
interface MatchRow {
  lineRecordId: RecordId
  line: VendorBillLineValues
  /** Null when the line carries no purchase order line — a bill with no PO is legal. */
  quantityReceived: number | null
  /** Integer minor units. Null for the same reason. */
  expectedUnitPrice: number | null
  /**
   * Billed amount less what the agreed price would have made it, integer minor
   * units. Null when either side is missing — an unknown variance is not zero.
   */
  variance: number | null
}

export function VendorBillMatchCard({ recordId }: DrawerTabProps) {
  const { rows, isLoading } = useVendorBillLines(recordId)

  const { values: header } = useSystemValues(recordId, [...BILL_MATCH_ATTRIBUTES], {
    autoFetch: true,
  })
  const currencyCode = (header.vendor_bill_currency as string | undefined) || 'USD'
  const status = firstValue(header.vendor_bill_status) ?? 'draft'
  const storedVariance = toNumber(header.vendor_bill_match_variance)
  const matchNotes = (header.vendor_bill_match_notes as string | undefined) ?? ''

  // The purchase order lines this bill points at. One batched read across
  // whatever definitions the ids belong to — the hook resolves each attribute
  // against the record's OWN definition, so mixing is safe.
  const purchaseOrderLineIds = useMemo(
    () =>
      rows.map((row) => row.values.purchaseOrderLineRecordId).filter((id): id is RecordId => !!id),
    [rows]
  )

  const { valuesById: poLineValues } = useSystemValuesForRecords(
    purchaseOrderLineIds,
    PO_LINE_MATCH_ATTRIBUTES,
    { autoFetch: true, enabled: purchaseOrderLineIds.length > 0 }
  )

  const matchRows: MatchRow[] = useMemo(
    () =>
      rows.map(({ lineRecordId, values }) => {
        const poLine = values.purchaseOrderLineRecordId
          ? poLineValues[values.purchaseOrderLineRecordId]
          : undefined
        const quantityReceived = toNumber(poLine?.purchase_order_line_quantity_received)
        const expectedUnitPrice = toNumber(poLine?.purchase_order_line_expected_unit_price)

        // Billed less expected, at the quantity the vendor billed. Rounded once,
        // on the product — `CURRENCY` is minor units in a double column, so an
        // unrounded product leaks a fraction of a cent into the variance.
        const variance =
          values.lineTotal === null || expectedUnitPrice === null || values.quantityBilled === null
            ? null
            : values.lineTotal - Math.round(values.quantityBilled * expectedUnitPrice)

        return { lineRecordId, line: values, quantityReceived, expectedUnitPrice, variance }
      }),
    [rows, poLineValues]
  )

  /**
   * The line variances, summed — shown only when the hook has not written a
   * bill-level figure yet.
   *
   * TODO(phase-3-router): `vendor_bill_match_variance` and
   * `vendor_bill_match_notes` are written by the match hook of §6.2, which does
   * not exist yet. `matchBill` / `matchVariance` DO exist
   * (`packages/lib/src/purchasing/match.ts`, re-exported from that module's
   * `client.ts`), but `packages/lib/package.json` carries no `./purchasing/client`
   * export subpath yet, so this card cannot reach them. Once that subpath is
   * generated, replace this sum with `matchVariance(...)` and read the outcome
   * from `matchBill(...)` rather than colouring cells by raw inequality — the
   * tolerances are settings, and this arithmetic is a read of them, not a ruling.
   */
  const derivedVariance = useMemo(
    () => matchRows.reduce((sum, row) => sum + (row.variance ?? 0), 0),
    [matchRows]
  )
  const variance = storedVariance ?? derivedVariance

  const statusBadge = STATUS_BADGE[status]

  if (isLoading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-6 w-40' />
        <Skeleton className='h-24 w-full' />
      </div>
    )
  }

  if (matchRows.length === 0) {
    return (
      <EmptySection
        icon={<ScanSearch className='size-5' />}
        title='Nothing to match'
        description='Add bill lines and link them to purchase order lines to compare them.'
      />
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-2 pe-3'>
        <div className='flex items-center gap-2'>
          {statusBadge && (
            <Badge variant={statusBadge.variant} size='sm'>
              {statusBadge.label}
            </Badge>
          )}
          {matchNotes && <span className='text-xs text-muted-foreground'>{matchNotes}</span>}
        </div>
        <div className='text-sm'>
          <span className='text-muted-foreground'>Variance </span>
          <span className={cn('tabular-nums', variance !== 0 && 'font-medium text-amber-600')}>
            {formatSignedMoney(variance, currencyCode)}
          </span>
        </div>
      </div>

      <div className='max-h-[24rem] overflow-auto border-y'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead className='text-right'>Billed</TableHead>
              <TableHead className='text-right'>Received</TableHead>
              <TableHead className='text-right'>Billed price</TableHead>
              <TableHead className='text-right'>Expected price</TableHead>
              <TableHead className='text-right'>Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matchRows.map((row) => {
              // Quantity is exact by default (§6.1): a partial delivery is not a
              // price problem and should be visible as its own thing.
              const quantityDiffers =
                row.quantityReceived !== null &&
                row.line.quantityBilled !== null &&
                row.line.quantityBilled !== row.quantityReceived
              const priceDiffers =
                row.expectedUnitPrice !== null &&
                row.line.unitPrice !== null &&
                row.line.unitPrice !== row.expectedUnitPrice

              return (
                <TableRow key={row.lineRecordId}>
                  <TableCell className='max-w-[12rem]'>
                    {row.line.partRecordId ? (
                      <RecordBadge recordId={row.line.partRecordId} size='sm' link />
                    ) : (
                      <span className='truncate'>
                        {row.line.description || (
                          <span className='text-muted-foreground'>Untitled line</span>
                        )}
                      </span>
                    )}
                    {!row.line.purchaseOrderLineRecordId && (
                      <div className='text-xs text-muted-foreground'>Not linked to a PO line</div>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      quantityDiffers && 'font-medium text-amber-600'
                    )}>
                    {formatQuantity(row.line.quantityBilled)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      quantityDiffers ? 'font-medium text-amber-600' : 'text-muted-foreground'
                    )}>
                    {formatQuantity(row.quantityReceived)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      priceDiffers && 'font-medium text-amber-600'
                    )}>
                    {formatMoney(row.line.unitPrice, currencyCode)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      priceDiffers ? 'font-medium text-amber-600' : 'text-muted-foreground'
                    )}>
                    {formatMoney(row.expectedUnitPrice, currencyCode)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      row.variance !== null && row.variance !== 0 && 'font-medium text-amber-600'
                    )}>
                    {formatSignedMoney(row.variance, currencyCode)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
