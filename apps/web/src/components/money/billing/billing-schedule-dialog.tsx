// apps/web/src/components/money/billing/billing-schedule-dialog.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { BaseType } from '~/components/workflow/types/unified-types'
import { api } from '~/trpc/react'
import type { BillingInstallmentRow, WorkOrderBillingView } from './types'

type Page = 'schedule' | 'review'
type EditableRow = {
  key: string
  name: string
  calculation: 'percentage' | 'fixed'
  value: number
  trigger: 'manual' | 'date' | 'work_order_completion'
  scheduledDate: string
}

const CALCULATION_OPTIONS = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed amount' },
]

const TRIGGER_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'date', label: 'Date' },
  { value: 'work_order_completion', label: 'Completion' },
]

const presetRows = (values: Array<[string, number, EditableRow['trigger']]>): EditableRow[] =>
  values.map(([name, value, trigger], index) => ({
    key: `${Date.now()}-${index}`,
    name,
    calculation: 'percentage',
    value,
    trigger,
    scheduledDate: '',
  }))

function fromInstallment(row: BillingInstallmentRow): EditableRow {
  return {
    key: row.id,
    name: row.name,
    calculation: row.calculation,
    value:
      row.calculation === 'percentage' ? (row.percentageBasisPoints ?? 0) / 100 : row.amount / 100,
    trigger: row.trigger,
    scheduledDate: row.scheduledDate ?? '',
  }
}

/** Fixed-contract installment editor with exact-total review and useful presets. */
export function BillingScheduleDialog({
  open,
  onOpenChange,
  workOrderRecordId,
  billing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrderRecordId: RecordId
  billing: WorkOrderBillingView
}) {
  const [page, setPage] = useState<Page>('schedule')
  const [rows, setRows] = useState<EditableRow[]>([])
  const editableExisting = useMemo(
    () => billing.installments.filter((row) => row.status === 'pending').map(fromInstallment),
    [billing.installments]
  )
  const lockedTotal = billing.installments
    .filter((row) => row.status === 'drafted' || row.status === 'invoiced')
    .reduce((sum, row) => sum + row.amount, 0)
  const scheduledTotal = rows.reduce(
    (sum, row) =>
      sum +
      (row.calculation === 'percentage'
        ? Math.floor((billing.billingAmount * row.value) / 100)
        : Math.round(row.value * 100)),
    lockedTotal
  )
  const utils = api.useUtils()
  const save = api.money.saveBillingInstallments.useMutation({
    onSuccess: async () => {
      await utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId })
      onOpenChange(false)
    },
    onError: (error) =>
      toastError({ title: 'Error saving payment schedule', description: error.message }),
  })

  useEffect(() => {
    if (!open) return
    setPage('schedule')
    setRows(
      editableExisting.length
        ? editableExisting
        : presetRows([
            ['Start', 50, 'manual'],
            ['Completion', 50, 'work_order_completion'],
          ])
    )
  }, [editableExisting, open])

  const update = (index: number, values: Partial<EditableRow>) =>
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...values } : row))
    )
  const submit = () =>
    save.mutate({
      workOrderRecordId,
      installments: rows.map((row) => ({
        name: row.name,
        calculation: row.calculation,
        percentageBasisPoints:
          row.calculation === 'percentage' ? Math.round(row.value * 100) : undefined,
        amount: row.calculation === 'fixed' ? Math.round(row.value * 100) : undefined,
        trigger: row.trigger,
        scheduledDate: row.trigger === 'date' ? row.scheduledDate : undefined,
      })),
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title='Set up payment schedule'
          description='Installments must add up to the full contract value.'
          onBack={page === 'review' ? () => setPage('schedule') : undefined}
          crumbs={[{ label: page === 'schedule' ? 'Schedule' : 'Review' }]}
        />
        <DialogNavPages value={page}>
          <DialogNavPage value='schedule' size='lg'>
            <div className='space-y-3 p-4'>
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  size='xs'
                  onClick={() =>
                    setRows(
                      presetRows([
                        ['Start', 50, 'manual'],
                        ['Completion', 50, 'work_order_completion'],
                      ])
                    )
                  }>
                  50 / 50
                </Button>
                <Button
                  variant='outline'
                  size='xs'
                  onClick={() =>
                    setRows(
                      presetRows([
                        ['Deposit', 30, 'manual'],
                        ['Midpoint', 40, 'manual'],
                        ['Completion', 30, 'work_order_completion'],
                      ])
                    )
                  }>
                  30 / 40 / 30
                </Button>
              </div>
              <div className='divide-y rounded-xl border'>
                {rows.map((row, index) => (
                  <TreeRow
                    key={row.key}
                    icon={<CalendarClock />}
                    title={row.name || `Installment ${index + 1}`}
                    secondary={
                      row.calculation === 'percentage'
                        ? `${row.value}%`
                        : formatCurrency(Math.round(row.value * 100), billing.currencyCode)
                    }
                    actions={
                      <TreeRowButton
                        variant='destructive'
                        tooltipText='Remove installment'
                        aria-label='Remove installment'
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                        <Trash2 />
                      </TreeRowButton>
                    }>
                    <div className='px-10 pb-3'>
                      <FieldPanel
                        orientation='responsive'
                        resizeId='billing-schedule-installment'
                        defaultLabelWidth={110}
                        className='p-0'>
                        <FieldPanelRow title='Name' type={BaseType.STRING} showIcon isRequired>
                          <FieldInputAdapter
                            fieldType={FieldType.TEXT}
                            value={row.name}
                            onChange={(value) => update(index, { name: value as string })}
                            placeholder='Installment name'
                          />
                        </FieldPanelRow>
                        <FieldPanelRow title='Calculation' type={BaseType.ENUM} showIcon isRequired>
                          <FieldInputAdapter
                            fieldType={FieldType.SINGLE_SELECT}
                            fieldOptions={{ options: CALCULATION_OPTIONS }}
                            triggerProps={{ className: 'w-full ps-0 pe-1' }}
                            value={[row.calculation]}
                            onChange={(value) =>
                              update(index, {
                                calculation: (value as EditableRow['calculation'][])[0],
                              })
                            }
                          />
                        </FieldPanelRow>
                        <FieldPanelRow
                          title={row.calculation === 'percentage' ? 'Percentage' : 'Amount'}
                          type={BaseType.NUMBER}
                          showIcon
                          isRequired>
                          <FieldInputAdapter
                            fieldType={FieldType.NUMBER}
                            value={row.value || null}
                            onChange={(value) => update(index, { value: Number(value) })}
                          />
                        </FieldPanelRow>
                        <FieldPanelRow title='Trigger' type={BaseType.ENUM} showIcon isRequired>
                          <FieldInputAdapter
                            fieldType={FieldType.SINGLE_SELECT}
                            fieldOptions={{ options: TRIGGER_OPTIONS }}
                            triggerProps={{ className: 'w-full ps-0 pe-1' }}
                            value={[row.trigger]}
                            onChange={(value) =>
                              update(index, { trigger: (value as EditableRow['trigger'][])[0] })
                            }
                          />
                        </FieldPanelRow>
                        {row.trigger === 'date' && (
                          <FieldPanelRow
                            title='Scheduled date'
                            type={BaseType.DATE}
                            showIcon
                            isRequired>
                            <FieldInputAdapter
                              fieldType={FieldType.DATE}
                              value={row.scheduledDate}
                              onChange={(value) =>
                                update(index, { scheduledDate: value as string })
                              }
                            />
                          </FieldPanelRow>
                        )}
                      </FieldPanel>
                    </div>
                  </TreeRow>
                ))}
              </div>
              <Button
                variant='ghost'
                size='sm'
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    ...presetRows([[`Installment ${current.length + 1}`, 0, 'manual']]),
                  ])
                }>
                <Plus /> Add installment
              </Button>
            </div>
            <DialogFooter>
              <Button variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={rows.length === 0}
                onClick={() => setPage('review')}>
                Review <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </DialogNavPage>
          <DialogNavPage value='review' size='md'>
            <div className='space-y-2 p-4 text-sm'>
              <FieldPanel orientation='horizontal' defaultLabelWidth={150} className='p-0'>
                <ReviewRow
                  label='Contract total'
                  value={formatCurrency(billing.billingAmount, billing.currencyCode)}
                />
                <ReviewRow
                  label='Locked installments'
                  value={formatCurrency(lockedTotal, billing.currencyCode)}
                />
                <ReviewRow
                  label='Scheduled total'
                  value={formatCurrency(scheduledTotal, billing.currencyCode)}
                />
              </FieldPanel>
              {scheduledTotal !== billing.billingAmount && (
                <p className='text-xs text-destructive'>
                  The schedule must equal the contract total.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => onOpenChange(false)}
                disabled={save.isPending}>
                Cancel
              </Button>
              <Button
                variant='outline'
                size='sm'
                loading={save.isPending}
                loadingText='Saving...'
                disabled={scheduledTotal !== billing.billingAmount}
                onClick={submit}>
                Save schedule <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <FieldPanelRow title={label}>
      <div className='flex min-h-8 items-center justify-end px-2 tabular-nums'>{value}</div>
    </FieldPanelRow>
  )
}
