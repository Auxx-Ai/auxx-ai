// apps/web/src/components/drawers/tabs/part-vendors-tab-row.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
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
import Link from 'next/link'
import { Tooltip } from '~/components/global/tooltip'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

const VENDOR_PART_ATTRIBUTES = [
  'vendor_part_vendor_sku',
  'vendor_part_unit_price',
  'vendor_part_lead_time',
  'vendor_part_is_preferred',
  'vendor_part_contact',
] as const

const CONTACT_NAME_ATTRIBUTES = ['name'] as const

interface VendorPartRowProps {
  recordId: RecordId
  onEdit: () => void
  onDelete: () => void
  onSetPreferred: () => void
}

/** A single vendor part row that subscribes to its own field values */
export function VendorPartRow({ recordId, onEdit, onDelete, onSetPreferred }: VendorPartRowProps) {
  const { values } = useSystemValues(recordId, VENDOR_PART_ATTRIBUTES, { autoFetch: true })

  const vendorSku = values.vendor_part_vendor_sku as string | undefined
  const unitPrice = values.vendor_part_unit_price as number | null | undefined
  const leadTime = values.vendor_part_lead_time as number | null | undefined
  const isPreferred = values.vendor_part_is_preferred as boolean | undefined
  const contactId = values.vendor_part_contact as string | undefined

  return (
    <TableRow>
      <TableCell className='font-medium'>
        <div className='flex items-center gap-2'>
          {contactId ? (
            <Link
              href={`/app/contacts?c=${contactId}&tab=parts`}
              className='truncate hover:underline'>
              <ContactName contactId={contactId} />
            </Link>
          ) : (
            <span className='text-muted-foreground'>Unknown</span>
          )}
          {isPreferred && (
            <Tooltip content='Preferred Supplier'>
              <Badge variant='green' size='sm' className='size-5 flex items-center justify-center'>
                <Star className='size-3 fill-current' />
              </Badge>
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

/** Inline component that resolves contact name from the entity system */
function ContactName({ contactId }: { contactId: string }) {
  const { values } = useSystemValues(`contact:${contactId}` as RecordId, CONTACT_NAME_ATTRIBUTES, {
    autoFetch: true,
  })
  const name = values.name as { firstName?: string; lastName?: string } | string | undefined

  if (!name) return <span>Loading...</span>
  if (typeof name === 'string') return <span>{name}</span>
  const displayName = [name.firstName, name.lastName].filter(Boolean).join(' ')
  return <span>{displayName || 'Unknown'}</span>
}
