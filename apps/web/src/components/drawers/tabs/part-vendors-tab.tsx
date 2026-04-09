// apps/web/src/components/drawers/tabs/part-vendors-tab.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { Store } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { VendorPartDialog } from '~/components/manufacturing/parts/vendor-part-dialog'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { VendorPartRow } from './part-vendors-tab-row'

/** Vendors tab content for parts drawer */
export function PartVendorsTab({ recordId }: DrawerTabProps) {
  const [isVendorDialogOpen, setIsVendorDialogOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Extract partId from recordId
  const { entityInstanceId: partId } = parseRecordId(recordId)

  // Resolve vendor_part entity definition ID
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')

  // Filter vendor parts by parent part
  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'part-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'part-match',
            fieldId: 'vendor_part:part' as ResourceFieldId,
            operator: 'is' as const,
            value: partId,
          },
        ],
      },
    ],
    [partId]
  )

  const { records, isLoading, refresh } = useRecordList({
    entityDefinitionId: vendorPartDefId ?? '',
    filters,
    enabled: !!partId && !!vendorPartDefId,
  })

  // Delete via entity system
  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => {
      refresh()
    },
    onError: (error) => {
      toastError({ title: 'Error removing supplier', description: error.message })
    },
  })

  // Save field value for setting preferred
  const { saveMultipleAsync } = useSaveFieldValue({})

  /** Handle delete vendor part with confirmation */
  const handleDeleteVendorPart = useCallback(
    async (instanceId: string) => {
      const confirmed = await confirmDelete({
        title: 'Remove Supplier',
        description: 'Are you sure you want to remove this supplier from the part?',
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
      setIsVendorDialogOpen(true)
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
    setIsVendorDialogOpen(open)
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
    <ScrollArea className='flex-1'>
      <Section
        title={`Suppliers (${records.length})`}
        initialOpen
        actions={
          <Button variant='ghost' size='xs' onClick={() => setIsVendorDialogOpen(true)}>
            <Store />
            Add Supplier
          </Button>
        }>
        {records.length === 0 ? (
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
                {records.map((record) => (
                  <VendorPartRow
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

      {/* Vendor Part Dialog */}
      <VendorPartDialog
        open={isVendorDialogOpen}
        onOpenChange={handleDialogOpenChange}
        partId={partId}
        recordId={editingRecordId ?? undefined}
        onSuccess={refresh}
      />

      <ConfirmDeleteDialog />
    </ScrollArea>
  )
}
