// apps/web/src/components/drawers/tabs/contact-parts-tab.tsx
'use client'

import type { VendorPartEntity as VendorPart } from '@auxx/database/models'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
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
import { formatCurrency } from '@auxx/utils/currency'
import { pluralize } from '@auxx/utils/strings'
import { Edit, MoreHorizontal, Package, Star, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { VendorPartDialog } from '~/components/manufacturing/parts/vendor-part-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/**
 * Parts tab for contact drawer - shows parts this contact supplies
 */
export function ContactPartsTab({ entityInstanceId }: DrawerTabProps) {
  const contactId = entityInstanceId
  const utils = api.useUtils()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingVendorPart, setEditingVendorPart] = useState<VendorPart | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Fetch vendor parts for this contact
  const { data, isLoading } = api.vendorPart.all.useQuery({ query: { contactId } })
  const vendorParts = data?.vendorParts ?? []

  // Delete vendor part mutation
  const deleteVendorPart = api.vendorPart.delete.useMutation({
    onSuccess: () => {
      utils.vendorPart.all.invalidate({ query: { contactId } })
    },
    onError: (error) => {
      toastError({ title: 'Error removing part', description: error.message })
    },
  })

  // Update vendor part mutation (for setting preferred)
  const updateVendorPart = api.vendorPart.update.useMutation({
    onSuccess: () => {
      utils.vendorPart.all.invalidate({ query: { contactId } })
    },
    onError: (error) => {
      toastError({ title: 'Error updating part', description: error.message })
    },
  })

  /** Handle delete vendor part with confirmation */
  const handleDeleteVendorPart = useCallback(
    async (vendorPart: any) => {
      const confirmed = await confirmDelete({
        title: 'Remove Part',
        description: 'Are you sure you want to remove this part from the contact?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteVendorPart.mutate({
          contactId: vendorPart.contactId,
          id: vendorPart.id,
        })
      }
    },
    [confirmDelete, deleteVendorPart]
  )

  /** Handle edit vendor part */
  const handleEditVendorPart = useCallback((vendorPart: any) => {
    setEditingVendorPart(vendorPart)
    setIsDialogOpen(true)
  }, [])

  /** Handle set as preferred */
  const handleSetPreferred = useCallback(
    (vendorPart: any) => {
      updateVendorPart.mutate({
        id: vendorPart.id,
        contactId: vendorPart.contactId,
        partId: vendorPart.partId,
        vendorSku: vendorPart.vendorSku,
        isPreferred: true,
      })
    },
    [updateVendorPart]
  )

  /** Handle dialog close */
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open)
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

  return (
    <>
      <div className='p-4 space-y-6'>
        <div>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-sm font-medium text-muted-foreground'>
              Parts ({vendorParts.length})
            </h3>
            <Button variant='ghost' size='xs' onClick={() => setIsDialogOpen(true)}>
              <Package />
              Add Part
            </Button>
          </div>

          {vendorParts.length === 0 ? (
            <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
              <Package className='mb-2 h-6 w-6 text-muted-foreground' />
              <p className='text-sm text-muted-foreground'>No parts added yet</p>
              <p className='text-xs text-muted-foreground'>Add parts that this contact supplies</p>
            </div>
          ) : (
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead>Vendor SKU</TableHead>
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
                          <div className='flex flex-col'>
                            <Link
                              href={`/app/parts?p=${vendorPart.partId}&tab=vendors`}
                              className='truncate hover:underline'>
                              {vendorPart.part?.title ?? 'Unknown'}
                            </Link>
                            <span className='text-xs text-muted-foreground'>
                              {vendorPart.part?.sku ?? '-'}
                            </span>
                          </div>
                          {vendorPart.isPreferred && (
                            <Badge className='bg-green-100 text-green-800 hover:bg-green-100'>
                              <Star className='mr-1 h-3 w-3 fill-current' />
                              Preferred
                            </Badge>
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
        </div>
      </div>

      {/* Vendor Part Dialog - contact mode */}
      <VendorPartDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        contactId={contactId}
        vendorPart={editingVendorPart}
        onSuccess={() => {
          utils.vendorPart.all.invalidate({ query: { contactId } })
        }}
      />

      <ConfirmDeleteDialog />
    </>
  )
}
