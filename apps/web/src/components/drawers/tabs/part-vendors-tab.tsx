// apps/web/src/components/drawers/tabs/part-vendors-tab.tsx
'use client'

import { selectWinningVendor } from '@auxx/lib/bom/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { Store } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { VendorPartDialog } from '~/components/manufacturing/parts/vendor-part-dialog'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'
import { VendorPartRow, type VendorPartRowValues } from './part-vendors-tab-row'

/**
 * Page size for the supplier list — a page size, NOT a cap. The effect below
 * drains every page; a part's supplier list is bounded, and the previous
 * default of 50 truncated with a header count that agreed with the truncation.
 */
const VENDOR_PAGE_SIZE = 100

/** Everything a supplier row renders, and everything the winner rule needs. */
const VENDOR_PART_ATTRIBUTES = [
  'vendor_part_vendor_sku',
  'vendor_part_unit_price',
  'vendor_part_shipping_cost',
  'vendor_part_tariff_rate',
  'vendor_part_other_cost',
  'vendor_part_lead_time',
  'vendor_part_is_preferred',
  'vendor_part_contact',
] as const

/** Narrow one record's raw system values into the row's shape. */
function toRowValues(values: Record<string, unknown> | undefined): VendorPartRowValues {
  const contact = values?.vendor_part_contact as RecordId[] | undefined
  return {
    vendorSku: values?.vendor_part_vendor_sku as string | undefined,
    unitPrice: (values?.vendor_part_unit_price as number | null | undefined) ?? null,
    shippingCost: (values?.vendor_part_shipping_cost as number | null | undefined) ?? null,
    tariffRate: (values?.vendor_part_tariff_rate as number | null | undefined) ?? null,
    otherCost: (values?.vendor_part_other_cost as number | null | undefined) ?? null,
    leadTime: (values?.vendor_part_lead_time as number | null | undefined) ?? null,
    isPreferred: (values?.vendor_part_is_preferred as boolean | undefined) ?? false,
    supplierRecordId: contact?.[0],
  }
}

/** Vendors tab content for parts drawer */
export function PartVendorsTab({ recordId }: DrawerTabProps) {
  const [isVendorDialogOpen, setIsVendorDialogOpen] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<RecordId | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Extract partId from recordId
  const { entityInstanceId: partId } = parseRecordId(recordId)

  // Resolve vendor_part entity definition ID
  const vendorPartDefId = useResourceProperty('vendor_part', 'id')
  // The tab is gated on READ of vendor_part (drawer config `recordResource`);
  // adding one additionally needs WRITE.
  const { canEditEntity } = useAccess()
  const canCreate = !!vendorPartDefId && canEditEntity(vendorPartDefId)

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

  const { recordIds, total, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage, refresh } =
    useRecordList({
      entityDefinitionId: vendorPartDefId ?? '',
      filters,
      limit: VENDOR_PAGE_SIZE,
      enabled: !!partId && !!vendorPartDefId,
    })

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isLoading) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isLoading, fetchNextPage])

  // 🛑 Ids, not `records`. `records` resolves from the record store in a second
  // wave, and a list served from the store cache reports `isLoading: false`
  // with the ids already known — so a `records`-keyed count renders short (or
  // renders the empty state) for that window. Rows need only the id.
  const rowRecordIds = useMemo(
    () => (vendorPartDefId ? recordIds.map((id) => toRecordId(vendorPartDefId, id)) : []),
    [recordIds, vendorPartDefId]
  )

  // Lifted out of the rows: the winner is a property of the LIST, so no row can
  // compute it from its own subscription. One batched read serves both.
  const { valuesById } = useSystemValuesForRecords(rowRecordIds, VENDOR_PART_ATTRIBUTES, {
    autoFetch: true,
    enabled: rowRecordIds.length > 0,
  })

  /**
   * Which offer the part's Cost came from.
   *
   * Computed with the same function the server-side calculator uses, never by
   * matching rows against the stored `part_purchase_cost`: that value is a
   * float produced by `unitPrice * (tariffRate / 100)`, and equality on it is
   * not a safe key.
   */
  const winningRecordId = useMemo(() => {
    const offers = rowRecordIds.map((recordId) => ({
      id: recordId,
      ...toRowValues(valuesById[recordId]),
    }))
    return selectWinningVendor(offers)?.id ?? null
  }, [rowRecordIds, valuesById])

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
        title={`Suppliers (${total})`}
        initialOpen
        actions={
          canCreate ? (
            <Button variant='ghost' size='xs' onClick={() => setIsVendorDialogOpen(true)}>
              <Store />
              Add Supplier
            </Button>
          ) : undefined
        }>
        {recordIds.length === 0 ? (
          <div className='flex h-24 flex-col items-center justify-center text-center border rounded-lg bg-muted/30'>
            <Store className='mb-2 h-6 w-6 text-muted-foreground' />
            <p className='text-sm text-muted-foreground'>No suppliers added yet</p>
            <p className='text-xs text-muted-foreground'>
              Add companies as suppliers for this part
            </p>
          </div>
        ) : (
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className='text-right'>Price</TableHead>
                  <TableHead className='text-right'>Landed</TableHead>
                  <TableHead className='text-right'>Lead Time</TableHead>
                  <TableHead className='w-10'></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recordIds.map((id, index) => {
                  const rowRecordId = rowRecordIds[index] as RecordId
                  return (
                    <VendorPartRow
                      key={id}
                      recordId={rowRecordId}
                      values={toRowValues(valuesById[rowRecordId])}
                      isWinner={rowRecordId === winningRecordId}
                      onEdit={() => handleEditVendorPart(id)}
                      onDelete={() => handleDeleteVendorPart(id)}
                      onSetPreferred={() => handleSetPreferred(id)}
                    />
                  )
                })}
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
