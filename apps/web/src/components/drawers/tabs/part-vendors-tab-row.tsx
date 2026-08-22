// apps/web/src/components/drawers/tabs/part-vendors-tab-row.tsx
'use client'

import { computeLandedBreakdown, type LandedCostBreakdown } from '@auxx/lib/bom/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { TableCell, TableRow } from '@auxx/ui/components/table'
import { pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { BadgeCheck, Edit, MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useAccess } from '~/providers/capabilities-provider'

/**
 * One supplier offer, already read by the parent tab.
 *
 * The row is presentational on purpose. It used to own a `useSystemValues`
 * subscription, which meant no row could see its siblings — and "which offer
 * wins" is only answerable across the whole list. The tab now reads every row's
 * values in one batched subscription and hands them down.
 */
export interface VendorPartRowValues {
  vendorSku?: string
  unitPrice: number | null
  shippingCost: number | null
  tariffRate: number | null
  otherCost: number | null
  leadTime: number | null
  isPreferred: boolean
  /** Supplier `RecordId` (encodes the company entity def); `RecordBadge` resolves it. */
  supplierRecordId?: RecordId
}

interface VendorPartRowProps {
  recordId: RecordId
  values: VendorPartRowValues
  /**
   * Whether this offer is the one the part's Cost actually came from.
   *
   * Distinct from `isPreferred`, and both can be true at once: preference is
   * one input to the rule, not the rule. With nothing preferred the cheapest
   * landed offer wins, and before this marker existed nothing on screen said so.
   */
  isWinner: boolean
  onEdit: () => void
  onDelete: () => void
  onSetPreferred: () => void
}

/**
 * The landed cost, itemized.
 *
 * Every line is a whole minor unit and the four components sum to the total
 * exactly — see `computeLandedBreakdown`, which rounds the one term that can
 * carry a fraction. The tariff shows both its rate and the money that rate
 * produced, because "10%" alone does not answer where the tariff went.
 */
function LandedBreakdown({ breakdown }: { breakdown: LandedCostBreakdown }) {
  const rows: { label: string; value: number }[] = [
    { label: 'Unit price', value: breakdown.unitPrice },
    { label: 'Shipping', value: breakdown.shipping },
    { label: `Tariff (${breakdown.tariffRate}%)`, value: breakdown.tariff },
    { label: 'Other', value: breakdown.other },
  ]

  return (
    <div className='min-w-44 space-y-1'>
      {rows.map((row) => (
        <div key={row.label} className='flex justify-between gap-4 text-xs'>
          <span className='text-muted-foreground'>{row.label}</span>
          <span className='tabular-nums'>{row.value === 0 ? '—' : formatCurrency(row.value)}</span>
        </div>
      ))}
      <div className='flex justify-between gap-4 border-t pt-1 text-xs font-medium'>
        <span>Landed</span>
        <span className='tabular-nums'>{formatCurrency(breakdown.landed)}</span>
      </div>
    </div>
  )
}

/** A single supplier offer for a part. */
export function VendorPartRow({
  recordId,
  values,
  isWinner,
  onEdit,
  onDelete,
  onSetPreferred,
}: VendorPartRowProps) {
  // Read-only viewers of the vendor_part definition get the row without its
  // actions menu — every item in it (edit, set preferred, remove) is a write.
  const { canEditEntity } = useAccess()
  const canEdit = canEditEntity(parseRecordId(recordId).entityDefinitionId)

  const { vendorSku, unitPrice, leadTime, isPreferred, supplierRecordId } = values

  // One definition of the formula, shared with the cost calculator that
  // actually persists this number.
  const breakdown = computeLandedBreakdown({ id: recordId, ...values })

  return (
    <TableRow>
      <TableCell className='font-medium'>
        <div className='flex items-center gap-2'>
          {supplierRecordId ? (
            <RecordBadge recordId={supplierRecordId} variant='link' link={{ tab: 'parts' }} />
          ) : (
            <span className='text-muted-foreground'>—</span>
          )}
          {isPreferred && (
            <Tooltip content='Preferred supplier'>
              <div className='text-amber-500'>
                <Star className='size-3 fill-current' />
              </div>
            </Tooltip>
          )}
          {isWinner && (
            <Tooltip content="This supplier's landed cost is the part's Cost">
              <div className='text-emerald-600'>
                <BadgeCheck className='size-3.5' />
              </div>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell className='font-mono text-sm'>{vendorSku ?? '—'}</TableCell>
      <TableCell className='text-right tabular-nums'>
        {unitPrice != null ? (
          formatCurrency(unitPrice)
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {breakdown ? (
          // Always shown when there is a price. It previously rendered a dash
          // whenever landed equalled the unit price, which is most rows — a
          // supplier with no shipping, tariff or other costs still HAS a landed
          // cost, and it is that supplier's unit price.
          <Tooltip contentComponent={<LandedBreakdown breakdown={breakdown} />}>
            <span className='underline decoration-dotted underline-offset-4'>
              {formatCurrency(breakdown.landed)}
            </span>
          </Tooltip>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </TableCell>
      <TableCell className='text-right'>
        {leadTime ? (
          `${leadTime} ${pluralize(leadTime, 'day')}`
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </TableCell>
      <TableCell>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={onEdit}>
                <Edit />
                Edit
              </DropdownMenuItem>
              {!isPreferred && (
                <DropdownMenuItem onClick={onSetPreferred}>
                  <Star />
                  Set as Preferred
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={onDelete}>
                <Trash2 />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  )
}
