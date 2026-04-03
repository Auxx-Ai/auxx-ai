// apps/web/src/components/drawers/tabs/part-vendors-tab.tsx
'use client'

import type { VendorPartEntity as VendorPart } from '@auxx/database/types'
import { parseRecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { getContactDisplayName, pluralize } from '@auxx/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { Edit, MoreHorizontal, Star, Store, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { VendorPartDialog } from '~/components/manufacturing/parts/vendor-part-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** Vendors tab content for parts drawer */
export function PartVendorsTab({ recordId }: DrawerTabProps) {
  const utils = api.useUtils()
  const [isVendorDialogOpen, setIsVendorDialogOpen] = useState(false)
  const [editingVendorPart, setEditingVendorPart] = useState<VendorPart | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Extract partId from recordId
  const { entityInstanceId: partId } = parseRecordId(recordId)

  // Fetch part data
  const { data: part, isLoading } = api.part.byId.useQuery({ id: partId }, { enabled: !!partId })

  // Delete vendor part mutation
  const deleteVendorPart = api.vendorPart.delete.useMutation({
    onSuccess: () => {
      utils.part.byId.invalidate({ id: partId })
    },
    onError: (error) => {
      toastError({ title: 'Error removing supplier', description: error.message })
    },
  })

  // Update vendor part mutation (for setting preferred)
  const updateVendorPart = api.vendorPart.update.useMutation({
    onSuccess: () => {
      utils.part.byId.invalidate({ id: partId })
    },
    onError: (error) => {
      toastError({ title: 'Error updating supplier', description: error.message })
    },
  })

  /** Handle delete vendor part with confirmation */
  const handleDeleteVendorPart = useCallback(
    async (vendorPart: any) => {
      const confirmed = await confirmDelete({
        title: 'Remove Supplier',
        description: 'Are you sure you want to remove this supplier from the part?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteVendorPart.mutate({
          entityInstanceId: vendorPart.entityInstanceId,
          id: vendorPart.id,
        })
      }
    },
    [confirmDelete, deleteVendorPart]
  )

  /** Handle edit vendor part */
  const handleEditVendorPart = useCallback((vendorPart: any) => {
    setEditingVendorPart(vendorPart)
    setIsVendorDialogOpen(true)
  }, [])

  /** Handle set as preferred */
  const handleSetPreferred = useCallback(
    (vendorPart: any) => {
      updateVendorPart.mutate({
        id: vendorPart.id,
        entityInstanceId: vendorPart.entityInstanceId,
        partId: vendorPart.partId,
        vendorSku: vendorPart.vendorSku,
        isPreferred: true,
      })
    },
    [updateVendorPart]
  )

  /** Handle dialog close */
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsVendorDialogOpen(open)
    if (!open) {
      setEditingVendorPart(null)
    }
  }, [])

  if (isLoading) {
    return (
      <div className='p-4 space-y-4'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  if (!part) {
    return <div className='p-4 text-center text-muted-foreground'>Part not found</div>
  }

  const vendorParts = part.vendorParts ?? []

  return (
    <ScrollArea className='flex-1'>
      <Section
        title={`Suppliers (${vendorParts.length})`}
        initialOpen
        actions={
          <Button variant='ghost' size='xs' onClick={() => setIsVendorDialogOpen(true)}>
            <Store />
            Add Supplier
          </Button>
        }>
        {vendorParts.length === 0 ? (
          <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
            <Store className='mb-2 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No suppliers added yet</p>
            <p className='text-xs text-muted-foreground'>Add contacts as suppliers for this part</p>
          </div>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className='text-right'>Price</TableHead>
                  <TableHead className='text-right'>Lead Time</TableHead>
                  <TableHead className='w-10'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorParts.map((vendorPart: any) => (
                  <TableRow key={vendorPart.id}>
                    <TableCell className='font-medium'>
                      <div className='flex items-center gap-2'>
                        <Link
                          href={`/app/contacts?c=${vendorPart.entityInstanceId}&tab=parts`}
                          className='truncate hover:underline'>
                          {getContactDisplayName(vendorPart.contact) ?? 'Unknown'}
                        </Link>
                        {vendorPart.isPreferred && (
                          <Tooltip content='Preferred Supplier'>
                            <Badge
                              variant='green'
                              size='sm'
                              className='size-5 flex items-center justify-center'>
                              <Star className='size-3 fill-current' />
                            </Badge>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{vendorPart.vendorSku}</TableCell>
                    <TableCell className='text-right'>
                      {vendorPart.unitPrice ? (
                        formatCurrency(vendorPart.unitPrice)
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      {vendorPart.leadTime ? (
                        `${vendorPart.leadTime} ${pluralize(vendorPart.leadTime, 'day')}`
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
                          <DropdownMenuItem onClick={() => handleEditVendorPart(vendorPart)}>
                            <Edit />
                            Edit
                          </DropdownMenuItem>
                          {!vendorPart.isPreferred && (
                            <DropdownMenuItem onClick={() => handleSetPreferred(vendorPart)}>
                              <Star />
                              Set as Preferred
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant='destructive'
                            onClick={() => handleDeleteVendorPart(vendorPart)}>
                            <Trash2 />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      {/* Vendor Part Dialog */}
      <VendorPartDialog
        open={isVendorDialogOpen}
        onOpenChange={handleDialogOpenChange}
        partId={partId}
        vendorPart={editingVendorPart}
        onSuccess={() => {
          utils.part.byId.invalidate({ id: partId })
        }}
      />

      <ConfirmDeleteDialog />
    </ScrollArea>
  )
}
