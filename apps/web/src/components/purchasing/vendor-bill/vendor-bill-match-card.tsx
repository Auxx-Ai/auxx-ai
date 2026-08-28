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
// LAYOUT. The three legs are rendered as three PAIRS, not six columns. Six
// right-aligned money columns do not fit the drawer's ~400px min width without
// the headers colliding, and the pair is the unit of meaning anyway: `1 / 1` and
// `— / 100.00` are read as comparisons, where `Billed | Received | Billed price |
// Expected price` is read as a spreadsheet. Above them sits the same
// `PurchasingSummaryStrip` the Payment card uses, so the two cards in this drawer
// share one rhythm.
//
// What this card deliberately does NOT do is decide the outcome. Tolerances live
// in `matchBill` (phase 5) and are settings, not code; the verdict this card
// shows is the STORED `vendor_bill_status` / `matchVariance` / `matchNotes` the
// hook wrote. Re-deriving pass/fail on the client with guessed tolerances would
// produce a second, disagreeing answer on the same screen. The amber cell
// highlight is not that second answer — it marks two numbers that DIFFER, which
// is an observation about the row and true regardless of where the tolerance
// sits. The ruling is the badge and the reason list, and both come from the hook.
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
import { History, ScanSearch, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useSettings } from '~/hooks/use-settings'
import { PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
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

function firstString(raw: unknown): string | undefined {
  const value = unwrapValue(raw)
  return typeof value === 'string' && value ? value : undefined
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
  /** What the vendor is asking for on this line, integer minor units. */
  billedAmount: number
  /** What the receipt justifies at the agreed price, integer minor units. */
  expectedAmount: number
  /** `billedAmount - expectedAmount`, integer minor units. */
  variance: number
}

export function VendorBillMatchCard({ recordId }: DrawerTabProps) {
  const { rows, isLoading } = useVendorBillLines(recordId)
  const { getSetting } = useSettings({})

  const { values: header } = useSystemValues(recordId, [...BILL_MATCH_ATTRIBUTES], {
    autoFetch: true,
  })
  const currencyCode =
    firstString(header.vendor_bill_currency) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'
  const status = firstString(header.vendor_bill_status) ?? 'draft'
  const storedVariance = toNumber(header.vendor_bill_match_variance)

  // `describeMatchReasons` joins with `; `, so splitting on it recovers the list
  // the hook rolled up. One reason per row beats one wrapping paragraph wedged
  // between the badge and the variance, which is what this used to be.
  const reasons = useMemo(() => {
    const notes = firstString(header.vendor_bill_match_notes) ?? ''
    return notes
      .split('; ')
      .map((part) => part.trim())
      .filter(Boolean)
  }, [header.vendor_bill_match_notes])

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

        // Both sides mirror `matchVariance` EXACTLY, including its two choices
        // that look like bugs and are not:
        //
        //  - a missing number counts as 0, because that is what the hook rules
        //    on (`match-hook.ts` reads every leg with `?? 0`). Rendering `—` in
        //    the cell but treating it as unknown in the arithmetic is how this
        //    card used to show a dash on every row while the header said
        //    -$200.00.
        //  - expected is `quantityRECEIVED x expectedUnitPrice`, never
        //    `quantityBilled x ...`. Using the billed quantity nets an
        //    over-billed line out of its own variance, which is the exact
        //    failure the match exists to catch (see `matchVariance`).
        //
        // Rounded on the product: `CURRENCY` is minor units in a double column,
        // so an unrounded product leaks a fraction of a cent into the sum.
        const billedAmount = Math.round((values.quantityBilled ?? 0) * (values.unitPrice ?? 0))
        const expectedAmount = Math.round((quantityReceived ?? 0) * (expectedUnitPrice ?? 0))

        return {
          lineRecordId,
          line: values,
          quantityReceived,
          expectedUnitPrice,
          billedAmount,
          expectedAmount,
          variance: billedAmount - expectedAmount,
        }
      }),
    [rows, poLineValues]
  )

  const totals = useMemo(
    () =>
      matchRows.reduce(
        (sum, row) => ({
          billed: sum.billed + row.billedAmount,
          expected: sum.expected + row.expectedAmount,
        }),
        { billed: 0, expected: 0 }
      ),
    [matchRows]
  )

  // The strip shows the LIVE figure — the one the rows directly below it add up
  // to. A three-cell strip whose third cell is not the difference of the first
  // two is the worst thing this card can do, and that is what showing the stored
  // variance here produced: `-$30.00` above rows summing to `-$60.00`.
  //
  // The stored figure is not discarded. When it disagrees the verdict below was
  // computed against line data that has since changed, and saying so is more
  // useful than silently preferring either number — the badge and the reasons
  // are that stale verdict, so a reader needs to know how far to trust them.
  const variance = totals.billed - totals.expected
  const staleVariance = storedVariance !== null && storedVariance !== variance

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
    <div className='flex flex-col gap-3 pe-3'>
      {statusBadge && (
        <div>
          <Badge variant={statusBadge.variant} size='sm'>
            {statusBadge.label}
          </Badge>
        </div>
      )}

      <PurchasingSummaryStrip
        cells={[
          { label: 'Billed', value: formatCurrency(totals.billed, { currencyCode }) },
          { label: 'Expected', value: formatCurrency(totals.expected, { currencyCode }) },
          {
            label: 'Variance',
            value: formatSignedMoney(variance, currencyCode),
            tone: variance === 0 ? 'muted' : 'warning',
          },
        ]}
      />

      <div className='max-h-[24rem] overflow-auto border-t'>
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead>Line</TableHead>
              <TableHead className='text-right'>
                Qty
                <span className='block font-normal text-[0.6875rem] text-muted-foreground'>
                  billed / recv
                </span>
              </TableHead>
              <TableHead className='text-right'>
                Unit price
                <span className='block font-normal text-[0.6875rem] text-muted-foreground'>
                  billed / agreed
                </span>
              </TableHead>
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
                row.expectedUnitPrice !== null && row.line.unitPrice !== row.expectedUnitPrice

              return (
                <TableRow key={row.lineRecordId} className='border-0 hover:bg-transparent'>
                  <TableCell className='max-w-[10rem] align-top'>
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
                  <ComparisonCell
                    differs={quantityDiffers}
                    billed={formatQuantity(row.line.quantityBilled)}
                    expected={formatQuantity(row.quantityReceived)}
                  />
                  <ComparisonCell
                    differs={priceDiffers}
                    billed={formatMoney(row.line.unitPrice, currencyCode)}
                    expected={formatMoney(row.expectedUnitPrice, currencyCode)}
                  />
                  <TableCell
                    className={cn(
                      'text-right align-top tabular-nums',
                      row.variance === 0 ? 'text-muted-foreground' : 'font-medium text-amber-600'
                    )}>
                    {formatSignedMoney(row.variance, currencyCode)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {(reasons.length > 0 || staleVariance) && (
        <ul className='flex flex-col gap-1'>
          {staleVariance && (
            <li className='flex items-start gap-1.5 text-muted-foreground text-xs'>
              <History className='mt-0.5 size-3 shrink-0' />
              <span>
                Last checked at {formatSignedMoney(storedVariance, currencyCode)}, before the lines
                above changed. Editing a line re-runs the match.
              </span>
            </li>
          )}
          {reasons.map((reason) => (
            <li key={reason} className='flex items-start gap-1.5 text-muted-foreground text-xs'>
              <TriangleAlert className='mt-0.5 size-3 shrink-0 text-amber-600' />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One leg of the match as a pair — what the vendor billed over what the receipt
 * or the purchase order says. Both halves go amber together: the failure is the
 * disagreement, not either number on its own.
 */
function ComparisonCell({
  billed,
  expected,
  differs,
}: {
  billed: string
  expected: string
  differs: boolean
}) {
  return (
    <TableCell className='whitespace-nowrap text-right align-top tabular-nums'>
      <span className={cn(differs && 'font-medium text-amber-600')}>{billed}</span>
      <span className='px-1 text-muted-foreground'>/</span>
      <span className={cn(differs ? 'font-medium text-amber-600' : 'text-muted-foreground')}>
        {expected}
      </span>
    </TableCell>
  )
}
