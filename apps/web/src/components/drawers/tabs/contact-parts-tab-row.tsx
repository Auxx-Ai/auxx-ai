// apps/web/src/components/drawers/tabs/contact-parts-tab-row.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
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
import { Edit, MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { RecordBadge } from '~/components/resources/ui/record-badge'

const VENDOR_PART_ATTRIBUTES = [
  'vendor_part_vendor_sku',
  'vendor_part_unit_price',
  'vendor_part_lead_time',
  'vendor_part_is_preferred',
  'vendor_part_part',
] as const

interface ContactVendorPartRowProps {
  recordId: RecordId
  onEdit: () => void
  onDelete: () => void
  onSetPreferred: () => void
}

/** A single vendor part row for the contact parts tab */
export function ContactVendorPartRow({
  recordId,
  onEdit,
  onDelete,
  onSetPreferred,
}: ContactVendorPartRowProps) {
  const { values } = useSystemValues(recordId, VENDOR_PART_ATTRIBUTES, { autoFetch: true })

  const vendorSku = values.vendor_part_vendor_sku as string | undefined
  const unitPrice = values.vendor_part_unit_price as number | null | undefined
  const leadTime = values.vendor_part_lead_time as number | null | undefined
  const isPreferred = values.vendor_part_is_preferred as boolean | undefined
  const partId = (values.vendor_part_part as string[] | undefined)?.[0]

  return (
    <TableRow>
      <TableCell className='font-medium'>
        <div className='flex items-center gap-2'>
          {partId ? (
            <RecordBadge recordId={partId} variant='link' link={{ tab: 'vendors' }} />
          ) : (
            <span className='text-muted-foreground'>—</span>
          )}
          {isPreferred && (
            <Tooltip content='Preferred Supplier'>
              <div className='text-amber-500'>
                <Star className='size-3 fill-current' />
              </div>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell className='font-mono text-sm'>{vendorSku ?? '—'}</TableCell>
      <TableCell className='text-right'>
        {unitPrice ? formatCurrency(unitPrice) : <span className='text-muted-foreground'>—</span>}
      </TableCell>
      <TableCell className='text-right'>
        {leadTime ? (
          `${leadTime} ${pluralize(leadTime, 'day')}`
        ) : (
          <span className='text-muted-foreground'>—</span>
        )}
      </TableCell>
      <TableCell>
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
      </TableCell>
    </TableRow>
  )
}
