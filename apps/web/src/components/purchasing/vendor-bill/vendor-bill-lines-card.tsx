// apps/web/src/components/purchasing/vendor-bill/vendor-bill-lines-card.tsx
'use client'

// The vendor bill drawer's Overview "Lines" card — the `vendor_bill:lines` entry
// of `drawer-config.ts` (plans/purchasing/01-build-plan.md §5.1/§5.2).
//
// Drawer-only by design: a bill RECORDS something already settled, so there is
// nothing to iterate and it never earns a detail page. That is also why this is a
// card and not a tab — there is no second surface to share with.
//
// Two things about a bill line that a sell-side line does not have, and that this
// card is built around:
//   - `lineTotal` is TRANSCRIBED from the vendor's document, never recomputed
//     from qty x price. Recomputing would quietly correct the vendor's own
//     arithmetic, which is exactly the discrepancy the three-way match exists to
//     catch — so the amount is an input here and an em dash when absent.
//   - `purchaseOrderLine` is the match key. It is nullable because a bill with no
//     PO is legal (a freight invoice, a one-off), but where it is set it is what
//     `vendor-bill-match-card.tsx` reads the received quantity and expected price
//     through.
//
// The "Lines" section title is rendered by the drawer's `TabCardSection` wrapper,
// so this card must not draw one.

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { parseRecordId, type RecordId } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
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
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatCurrency } from '@auxx/utils/currency'
import { MoreHorizontal, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { toRecordId, useRecordList, useResourceProperty } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { PurchaseOrderLinePicker } from '../purchase-order/purchase-order-line-picker'

/** Header values the lines card needs: the currency and the transcribed totals. */
const BILL_HEADER_ATTRIBUTES = [
  'vendor_bill_currency',
  'vendor_bill_subtotal',
  'vendor_bill_shipping_total',
  'vendor_bill_tax_total',
  'vendor_bill_total',
] as const

/** Everything one bill line row renders. Exported for the match card. */
export const VENDOR_BILL_LINE_ATTRIBUTES = [
  'vendor_bill_line_purchase_order_line',
  'vendor_bill_line_part',
  'vendor_bill_line_description',
  'vendor_bill_line_quantity_billed',
  'vendor_bill_line_unit_price',
  'vendor_bill_line_line_total',
  'vendor_bill_line_gl_account',
  'vendor_bill_line_sort_order',
] as const

/** One bill line, narrowed out of the raw system-value bag. */
export interface VendorBillLineValues {
  purchaseOrderLineRecordId?: RecordId
  partRecordId?: RecordId
  description: string
  quantityBilled: number | null
  /** Integer minor units. */
  unitPrice: number | null
  /** Integer minor units — transcribed from the vendor document, never derived. */
  lineTotal: number | null
  glAccount: string
  sortOrder: number | null
}

/** A relation read comes back as `RecordId[]`; everything else as a scalar. */
function firstRecordId(raw: unknown): RecordId | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? (value as RecordId) : undefined
}

function toNumber(raw: unknown): number | null {
  return typeof raw === 'number' ? raw : null
}

/** Narrow one bill line's raw system values. Exported for the match card. */
export function toVendorBillLineValues(
  values: Record<string, unknown> | undefined
): VendorBillLineValues {
  return {
    purchaseOrderLineRecordId: firstRecordId(values?.vendor_bill_line_purchase_order_line),
    partRecordId: firstRecordId(values?.vendor_bill_line_part),
    description: (values?.vendor_bill_line_description as string | undefined) ?? '',
    quantityBilled: toNumber(values?.vendor_bill_line_quantity_billed),
    unitPrice: toNumber(values?.vendor_bill_line_unit_price),
    lineTotal: toNumber(values?.vendor_bill_line_line_total),
    glAccount: (values?.vendor_bill_line_gl_account as string | undefined) ?? '',
    sortOrder: toNumber(values?.vendor_bill_line_sort_order),
  }
}

/**
 * The bill's own lines, in document order.
 *
 * Shared with the match card so both surfaces read the same rows through one
 * batched value fetch rather than two competing ones.
 */
export function useVendorBillLines(billRecordId: RecordId) {
  const { entityInstanceId: billId } = parseRecordId(billRecordId)
  const lineDefId = useResourceProperty('vendor_bill_line', 'id')

  const filters: ConditionGroup[] = useMemo(
    () => [
      {
        id: 'vendor-bill-filter',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'vendor-bill-match',
            fieldId: 'vendor_bill_line:vendorBill' as ResourceFieldId,
            operator: 'is' as const,
            value: billId,
          },
        ],
      },
    ],
    [billId]
  )

  const { records, isLoading, refresh } = useRecordList({
    entityDefinitionId: lineDefId ?? '',
    filters,
    enabled: !!billId && !!lineDefId,
  })

  const rowRecordIds = useMemo(
    () => (lineDefId ? records.map((record) => toRecordId(lineDefId, record.id)) : []),
    [records, lineDefId]
  )

  const { valuesById } = useSystemValuesForRecords(rowRecordIds, VENDOR_BILL_LINE_ATTRIBUTES, {
    autoFetch: true,
    enabled: rowRecordIds.length > 0,
  })

  const rows = useMemo(
    () =>
      rowRecordIds
        .map((lineRecordId) => ({
          lineRecordId,
          values: toVendorBillLineValues(valuesById[lineRecordId]),
        }))
        .sort((a, b) => (a.values.sortOrder ?? 0) - (b.values.sortOrder ?? 0)),
    [rowRecordIds, valuesById]
  )

  return { billId, lineDefId, rows, isLoading, refresh }
}

function formatQuantity(value: number | null): string {
  return value === null ? '—' : String(value)
}

function formatMoney(value: number | null, currencyCode: string): string {
  return value === null ? '—' : formatCurrency(value, { currencyCode })
}

export function VendorBillLinesCard({ recordId }: DrawerTabProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingLineId, setEditingLineId] = useState<RecordId | null>(null)
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  const { billId, lineDefId, rows, isLoading, refresh } = useVendorBillLines(recordId)

  const { canEditEntity } = useAccess()
  const canEditLines = !!lineDefId && canEditEntity(lineDefId)

  const { values: header } = useSystemValues(recordId, [...BILL_HEADER_ATTRIBUTES], {
    autoFetch: true,
  })
  const currencyCode = (header.vendor_bill_currency as string | undefined) || 'USD'

  const nextSortOrder = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.values.sortOrder ?? 0), 0) + 1,
    [rows]
  )

  const deleteRecord = api.record.delete.useMutation({
    onSuccess: () => refresh(),
    onError: (error) =>
      toastError({ title: 'Error removing bill line', description: error.message }),
  })

  const handleDelete = useCallback(
    async (lineRecordId: RecordId) => {
      const confirmed = await confirmDelete({
        title: 'Remove bill line?',
        description: 'This removes the line from the vendor bill. This action cannot be undone.',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) deleteRecord.mutate({ recordId: lineRecordId })
    },
    [confirmDelete, deleteRecord]
  )

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open)
    if (!open) setEditingLineId(null)
  }, [])

  if (isLoading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-24 w-full' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {canEditLines && (
        <div className='flex justify-end pe-3'>
          <Button variant='ghost' size='xs' onClick={() => setIsDialogOpen(true)}>
            <Plus />
            Add line
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptySection
          icon={<ReceiptText className='size-5' />}
          title='No lines yet'
          description="Transcribe the lines from the supplier's invoice."
        />
      ) : (
        <div className='max-h-[24rem] overflow-auto border-y'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Part</TableHead>
                <TableHead className='text-right'>Qty</TableHead>
                <TableHead className='text-right'>Unit price</TableHead>
                <TableHead className='text-right'>Amount</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className='w-10' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ lineRecordId, values }) => (
                <TableRow key={lineRecordId}>
                  <TableCell className='max-w-[14rem] truncate'>
                    {values.description || <span className='text-muted-foreground'>—</span>}
                  </TableCell>
                  <TableCell>
                    {values.partRecordId ? (
                      <RecordBadge recordId={values.partRecordId} size='sm' link />
                    ) : (
                      <span className='text-muted-foreground'>—</span>
                    )}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatQuantity(values.quantityBilled)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatMoney(values.unitPrice, currencyCode)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatMoney(values.lineTotal, currencyCode)}
                  </TableCell>
                  <TableCell className='tabular-nums text-muted-foreground'>
                    {values.glAccount || '—'}
                  </TableCell>
                  <TableCell>
                    {canEditLines && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' size='xs' aria-label='Bill line actions'>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuItem
                            onClick={() => {
                              setEditingLineId(lineRecordId)
                              setIsDialogOpen(true)
                            }}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant='destructive'
                            onClick={() => handleDelete(lineRecordId)}>
                            <Trash2 /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Every figure here is transcribed from the vendor's document — none of it
          is derived from the lines above, for the same reason `lineTotal` is not. */}
      <div className='flex justify-end pe-3'>
        <dl className='w-52 space-y-1 text-sm'>
          <TotalRow
            label='Subtotal'
            value={formatMoney(
              (header.vendor_bill_subtotal as number | null | undefined) ?? null,
              currencyCode
            )}
          />
          <TotalRow
            label='Shipping'
            value={formatMoney(
              (header.vendor_bill_shipping_total as number | null | undefined) ?? null,
              currencyCode
            )}
          />
          <TotalRow
            label='Tax'
            value={formatMoney(
              (header.vendor_bill_tax_total as number | null | undefined) ?? null,
              currencyCode
            )}
          />
          <div className='border-t pt-1'>
            <TotalRow
              label='Total'
              value={formatMoney(
                (header.vendor_bill_total as number | null | undefined) ?? null,
                currencyCode
              )}
              emphasis
            />
          </div>
        </dl>
      </div>

      <VendorBillLineDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        billId={billId}
        lineRecordId={editingLineId ?? undefined}
        currencyCode={currencyCode}
        nextSortOrder={nextSortOrder}
        onSuccess={refresh}
      />

      <ConfirmDeleteDialog />
    </div>
  )
}

function TotalRow({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className={cn('flex justify-between', emphasis && 'font-medium')}>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='tabular-nums'>{value}</dd>
    </div>
  )
}

/** The editable half of a bill line. */
interface BillLineFormValues {
  purchaseOrderLineRecordId: RecordId | null
  partRecordId: RecordId | null
  description: string
  quantityBilled: number | null
  unitPrice: number | null
  lineTotal: number | null
  glAccount: string
}

const EMPTY_BILL_LINE_FORM: BillLineFormValues = {
  purchaseOrderLineRecordId: null,
  partRecordId: null,
  description: '',
  quantityBilled: null,
  unitPrice: null,
  lineTotal: null,
  glAccount: '',
}

/**
 * Add/edit one vendor bill line.
 *
 * Create goes through the generic `record.create`; edit through
 * `fieldValue.setBulk` via `useSaveFieldValue` — the same split every hidden
 * child entity managed from its parent uses.
 */
function VendorBillLineDialog({
  open,
  onOpenChange,
  billId,
  lineRecordId,
  currencyCode,
  nextSortOrder,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  billId: string
  lineRecordId?: RecordId
  currencyCode: string
  nextSortOrder: number
  onSuccess?: () => void
}) {
  const isEditMode = !!lineRecordId

  const lineDefId = useResourceProperty('vendor_bill_line', 'id')
  const billDefId = useResourceProperty('vendor_bill', 'id')

  const partField = useSystemField('vendor_bill_line_part')

  // The match key is picked from THIS bill's order and no other, through
  // `PurchaseOrderLinePicker` rather than the generic relationship input — which
  // offers every purchase order line in the org and can only label them by a
  // `displayName` a line does not have. See that file's header.
  const billRecordId = billDefId ? toRecordId(billDefId, billId) : null
  const { values: billValues } = useSystemValues(billRecordId, ['vendor_bill_purchase_order'], {
    autoFetch: true,
    enabled: open && !!billRecordId,
  })
  const purchaseOrderRecordId =
    extractRelationshipRecordIds(billValues.vendor_bill_purchase_order)[0] ?? null

  const { values: systemValues } = useSystemValues(lineRecordId, [...VENDOR_BILL_LINE_ATTRIBUTES], {
    autoFetch: true,
    enabled: isEditMode && open,
  })

  const [values, setValues] = useState<BillLineFormValues>(EMPTY_BILL_LINE_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    if (isEditMode) {
      const existing = toVendorBillLineValues(systemValues)
      setValues({
        purchaseOrderLineRecordId: existing.purchaseOrderLineRecordId ?? null,
        partRecordId: existing.partRecordId ?? null,
        description: existing.description,
        quantityBilled: existing.quantityBilled,
        unitPrice: existing.unitPrice,
        lineTotal: existing.lineTotal,
        glAccount: existing.glAccount,
      })
    } else {
      setValues(EMPTY_BILL_LINE_FORM)
    }
    setErrors({})
  }, [open, isEditMode, systemValues])

  const handleChange = useCallback((field: keyof BillLineFormValues, value: unknown) => {
    setValues((prev) => ({ ...prev, [field]: value }) as BillLineFormValues)
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const createRecord = api.record.create.useMutation({
    onError: (error) => toastError({ title: 'Error adding bill line', description: error.message }),
  })
  const { saveMultipleAsync, isPending: isSavingFields } = useSaveFieldValue({})
  const isPending = createRecord.isPending || isSavingFields

  const validate = () => {
    const next: Record<string, string> = {}
    if (values.quantityBilled === null) next.quantityBilled = 'Billed quantity is required'
    if (values.lineTotal === null) next.lineTotal = "Enter the amount from the supplier's invoice"
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    if (isEditMode && lineRecordId) {
      const ok = await saveMultipleAsync(lineRecordId, [
        {
          fieldId: 'vendor_bill_line_purchase_order_line',
          value: values.purchaseOrderLineRecordId,
          fieldType: FieldType.RELATIONSHIP,
        },
        {
          fieldId: 'vendor_bill_line_part',
          value: values.partRecordId,
          fieldType: FieldType.RELATIONSHIP,
        },
        {
          fieldId: 'vendor_bill_line_description',
          value: values.description,
          fieldType: FieldType.TEXT,
        },
        {
          fieldId: 'vendor_bill_line_quantity_billed',
          value: values.quantityBilled,
          fieldType: FieldType.NUMBER,
        },
        {
          fieldId: 'vendor_bill_line_unit_price',
          value: values.unitPrice,
          fieldType: FieldType.CURRENCY,
        },
        {
          fieldId: 'vendor_bill_line_line_total',
          value: values.lineTotal,
          fieldType: FieldType.CURRENCY,
        },
        {
          fieldId: 'vendor_bill_line_gl_account',
          value: values.glAccount,
          fieldType: FieldType.TEXT,
        },
      ])
      if (!ok) return
      onSuccess?.()
      onOpenChange(false)
      return
    }

    if (!lineDefId || !billDefId) return
    await createRecord.mutateAsync({
      entityDefinitionId: lineDefId,
      values: {
        vendor_bill_line_vendor_bill: toRecordId(billDefId, billId),
        vendor_bill_line_purchase_order_line: values.purchaseOrderLineRecordId,
        vendor_bill_line_part: values.partRecordId,
        vendor_bill_line_description: values.description,
        vendor_bill_line_quantity_billed: values.quantityBilled,
        vendor_bill_line_unit_price: values.unitPrice,
        vendor_bill_line_line_total: values.lineTotal,
        vendor_bill_line_gl_account: values.glAccount,
        vendor_bill_line_sort_order: nextSortOrder,
      },
    })
    onSuccess?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit bill line' : 'Add bill line'}</DialogTitle>
          <DialogDescription>
            Transcribe the line exactly as the supplier billed it — the amount is not recalculated
            from quantity and price.
          </DialogDescription>
        </DialogHeader>

        <FieldPanel className='p-0' breakpoint='md' resizeId='vendor-bill-line'>
          <FieldPanelRow
            title='Purchase order line'
            description='The match key. Leave empty for a bill with no purchase order.'>
            <PurchaseOrderLinePicker
              purchaseOrderRecordId={purchaseOrderRecordId}
              value={values.purchaseOrderLineRecordId ?? null}
              onChange={(next) => handleChange('purchaseOrderLineRecordId', next)}
              currencyCode={currencyCode}
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Part'>
            <FieldInputAdapter
              fieldType={partField?.fieldType ?? FieldType.RELATIONSHIP}
              fieldOptions={partField?.options}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              value={values.partRecordId ? [values.partRecordId] : []}
              onChange={(next) => {
                const ids = next as RecordId[]
                handleChange('partRecordId', ids[0] ?? null)
              }}
              placeholder='Select part...'
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Description'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.description}
              onChange={(next) => handleChange('description', (next as string) ?? '')}
              placeholder='As it reads on the invoice'
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Quantity billed'
            isRequired
            validationError={errors.quantityBilled}
            validationType='error'>
            <FieldInputAdapter
              fieldType={FieldType.NUMBER}
              value={values.quantityBilled}
              onChange={(next) => handleChange('quantityBilled', next as number | null)}
              placeholder='Enter quantity'
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow title='Unit price'>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={values.unitPrice}
              onChange={(next) => handleChange('unitPrice', next as number | null)}
              placeholder='What they charged per unit'
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='Amount'
            isRequired
            description='Transcribed from the invoice, not recomputed.'
            validationError={errors.lineTotal}
            validationType='error'>
            <FieldInputAdapter
              fieldType={FieldType.CURRENCY}
              fieldOptions={{ currencyCode, decimals: 2, useGrouping: true }}
              value={values.lineTotal}
              onChange={(next) => handleChange('lineTotal', next as number | null)}
              placeholder='Line amount as billed'
              disabled={isPending}
            />
          </FieldPanelRow>

          <FieldPanelRow
            title='GL account'
            description='An account code — 2160 for a PO-matched line, an expense code otherwise.'>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={values.glAccount}
              onChange={(next) => handleChange('glAccount', (next as string) ?? '')}
              placeholder='2160'
              disabled={isPending}
            />
          </FieldPanelRow>
        </FieldPanel>

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={isPending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText={isEditMode ? 'Saving...' : 'Adding...'}
            disabled={!lineDefId || !billDefId}
            data-dialog-submit>
            {isEditMode ? 'Save line' : 'Add line'} <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
