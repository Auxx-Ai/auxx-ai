// apps/web/src/components/drawers/tabs/contact-parts-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { Package } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { VendorPartDialog } from '~/components/manufacturing/parts/vendor-part-dialog'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { ContactVendorPartRow } from './contact-parts-tab-row'

/**
 * Parts tab for contact drawer - shows parts this contact supplies
 */
export function ContactPartsTab({ entityInstanceId }: DrawerTabProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Resolve vendor_part entity definition ID
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')

  // Filter vendor parts by contact
  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'contact-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'contact-match',
            fieldId: 'vendor_part:contact' as ResourceFieldId,
            operator: 'is' as const,
            value: entityInstanceId,
          },
        ],
      },
    ],
    [entityInstanceId]
  )

  const { records, isLoading, refresh } = useRecordList({
    entityDefinitionId: vendorPartDefId ?? '',
    filters,
    enabled: !!entityInstanceId && !!vendorPartDefId,
  })

  // Delete via entity system
  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toastError({ title: 'Error removing part', description: error.message }),
  })

  // Save field value for setting preferred
  const { saveMultipleAsync } = useSaveFieldValue({})

  /** Handle delete vendor part with confirmation */
  const handleDeleteVendorPart = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: 'Remove Part',
        description: 'Are you sure you want to remove this part from the contact?',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed && vendorPartDefId) {
        deleteRecord.mutate({ recordId: toRecordId(vendorPartDefId, instanceId) })
      }
    },
    [confirmDelete, deleteRecord, vendorPartDefId]
  )

  /** Handle edit vendor part */
  const handleEditVendorPart = useCallback(
    (instanceId: string) => {
      if (!vendorPartDefId) return
      setEditingRecordId(toRecordId(vendorPartDefId, instanceId))
      setIsDialogOpen(true)
    },
    [vendorPartDefId]
  )

  /** Handle set as preferred */
  const handleSetPreferred = useCallback(
    async (instanceId: string) => {
      if (!vendorPartDefId) return
      const vpRecordId = toRecordId(vendorPartDefId, instanceId)
      await saveMultipleAsync(vpRecordId, [
        { fieldId: 'vendor_part_is_preferred', value: true, fieldType: 'CHECKBOX' },
      ])
    },
    [vendorPartDefId, saveMultipleAsync]
  )

  /** Handle dialog close */
  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      setEditingRecordId(null)
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
      <ScrollArea className='flex-1'>
        <Section
          title={`Parts (${records.length})`}
          className='flex flex-col flex-1 min-h-0 w-full [&_[data-slot=section]]:flex-1 [&_[data-slot=section]]:border-b-0 [&_[data-slot=section-content]]:flex-1'
          collapsible={false}
          icon={<Package className='size-4 text-muted-foreground/50' />}
          actions={
            <Button variant='ghost' size='sm' onClick={() => setIsDialogOpen(true)}>
              <Package />
              Add Part
            </Button>
          }>
          {records.length === 0 ? (
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
                  {records.map((record) => (
                    <ContactVendorPartRow
                      key={record.id}
                      recordId={toRecordId(vendorPartDefId!, record.id)}
                      onEdit={() => handleEditVendorPart(record.id)}
                      onDelete={() => handleDeleteVendorPart(record.id)}
                      onSetPreferred={() => handleSetPreferred(record.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
      </ScrollArea>

      {/* Vendor Part Dialog - contact mode */}
      <VendorPartDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        entityInstanceId={entityInstanceId}
        recordId={editingRecordId ?? undefined}
        onSuccess={refresh}
      />

      <ConfirmDeleteDialog />
    </>
  )
}
