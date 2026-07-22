// apps/web/src/components/money/billing/billing-action-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import type { DateRange } from '@auxx/ui/components/date-range-picker'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { toastError } from '@auxx/ui/components/toast'
import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { CalendarClock, CircleDollarSign, Percent, ReceiptText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useResource } from '~/components/resources'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { BatchGeneratePage, BatchPreviewPage, BatchScopePage } from './batch-invoice-pages'
import { EMPTY_WORK_ORDER_BILLING, type WorkOrderBillingView } from './types'

type Page = 'choose' | 'review' | 'scope' | 'preview' | 'generate'
type FixedChoice = 'remaining' | 'percentage' | 'fixed' | `installment:${string}`

/**
 * Discriminated scope for the shared billing dialog (plans/dispatch/37a-batch-advance-invoicing.md
 * §3): `workOrder` is the original single-work-order flow (basis-routed invoice creation);
 * `batch` drives the period + filter → preview → generate advance-invoicing flow across many
 * work orders. Every `billing.*` read below is gated on `scope.kind === 'workOrder'` — batch
 * scope carries no `WorkOrderBillingView`.
 */
export type BillingDialogScope =
  | {
      kind: 'workOrder'
      workOrderRecordId: RecordId
      billing: WorkOrderBillingView
      initialVisitIds?: string[]
      mode?: 'primary' | 'extra'
    }
  | { kind: 'batch'; initialRange?: { from: Date; to: Date } }

interface BillingActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: BillingDialogScope
}

/** Default batch period: next calendar month (plan §3, decision "default: next calendar month"). */
function defaultBatchRange(): DateRange {
  const nextMonthStart = addMonths(startOfMonth(new Date()), 1)
  return { from: nextMonthStart, to: endOfMonth(nextMonthStart) }
}

/** Route a work order's billing basis to its explicit allocation-backed invoice command, or —
 * in batch scope — drive the period/filter → preview → generate advance-invoicing flow. */
export function BillingActionDialog({ open, onOpenChange, scope }: BillingActionDialogProps) {
  const isBatch = scope.kind === 'batch'
  // Batch scope carries no `WorkOrderBillingView` — fall back to the empty placeholder so the
  // single-work-order render tree below (never mounted while `isBatch`) can read `billing.*`
  // unconditionally instead of threading optional chaining through every picker.
  const billing = scope.kind === 'workOrder' ? scope.billing : EMPTY_WORK_ORDER_BILLING
  const workOrderRecordId = scope.kind === 'workOrder' ? scope.workOrderRecordId : undefined
  const mode = scope.kind === 'workOrder' ? (scope.mode ?? 'primary') : 'primary'
  const initialVisitIds = scope.kind === 'workOrder' ? scope.initialVisitIds : undefined

  const [page, setPage] = useState<Page>(isBatch ? 'scope' : 'choose')
  const [fixedChoice, setFixedChoice] = useState<FixedChoice>('remaining')
  const [inputValue, setInputValue] = useState<number | null>(null)
  // Deps stay granular (not `scope` itself — call sites build it inline, so its identity churns
  // every parent render and would reset the open dialog's page/selection mid-flow).
  const defaultVisits = useMemo(() => {
    if (isBatch) return []
    if (initialVisitIds?.length) return initialVisitIds
    // Extra mode defaults to DONE visits' extras only — upcoming visits' staged extras are
    // opt-in (plan money/19 §2: pre-billing is deliberate, never the default).
    if (mode === 'extra') {
      return [
        ...new Set(
          billing.extraWork.filter((row) => row.visitStatus === 'done').map((row) => row.visitId)
        ),
      ]
    }
    return billing.eligibleVisits.map((visit) => visit.id)
  }, [billing.eligibleVisits, billing.extraWork, initialVisitIds, mode, isBatch])
  const [visitIds, setVisitIds] = useState<string[]>(defaultVisits)
  const utils = api.useUtils()

  // ─── Batch scope state (plan §3, batch pages) ───────────────────────────
  const [batchRange, setBatchRange] = useState<DateRange>(
    scope.kind === 'batch' && scope.initialRange ? scope.initialRange : defaultBatchRange()
  )
  const [batchFilters, setBatchFilters] = useState<ConditionGroup[]>([])
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<RecordId>>(new Set())
  const { resource: invoiceResource } = useResource('invoices')

  const previewBatch = api.money.previewInvoiceBatch.useQuery(
    { range: batchRange, filters: batchFilters },
    { enabled: isBatch && page === 'preview' }
  )

  useEffect(() => {
    if (!previewBatch.data) return
    setBatchSelectedIds(
      new Set(
        previewBatch.data.rows
          .filter((row) => !row.excludedReason)
          .map((row) => row.workOrderRecordId)
      )
    )
  }, [previewBatch.data])

  const rowLabelByWorkOrderId = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of previewBatch.data?.rows ?? []) {
      map.set(row.workOrderRecordId, row.contactName ?? 'Work order')
    }
    return map
  }, [previewBatch.data])

  const runBatch = api.money.runInvoiceBatch.useMutation({
    onSuccess: async () => {
      if (!invoiceResource?.id) return
      await utils.record.listFiltered.invalidate({ entityDefinitionId: invoiceResource.id })
    },
    onError: (error) =>
      toastError({ title: 'Error generating batch invoices', description: error.message }),
  })

  const submitBatch = () => {
    setPage('generate')
    runBatch.mutate({ range: batchRange, workOrderRecordIds: [...batchSelectedIds] })
  }

  const batchInitialRange = scope.kind === 'batch' ? scope.initialRange : undefined
  const resetRunBatch = runBatch.reset

  useEffect(() => {
    if (!open) return
    setPage(isBatch ? 'scope' : 'choose')
    setFixedChoice('remaining')
    setInputValue(null)
    setVisitIds(defaultVisits)
    if (isBatch) {
      setBatchRange(batchInitialRange ?? defaultBatchRange())
      setBatchFilters([])
      setBatchSelectedIds(new Set())
      resetRunBatch()
    }
  }, [open, defaultVisits, isBatch, batchInitialRange, resetRunBatch])

  const invalidate = async () => {
    if (!workOrderRecordId) return
    await utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId })
    onOpenChange(false)
  }
  const fail = (error: { message: string }) =>
    toastError({ title: 'Error creating invoice', description: error.message })

  const createFixed = api.money.createFixedContractInvoice.useMutation({
    onSuccess: invalidate,
    onError: fail,
  })
  const createVisits = api.money.createVisitInvoice.useMutation({
    onSuccess: invalidate,
    onError: fail,
  })
  const createRecurring = api.money.createRecurringCharge.useMutation({
    onSuccess: invalidate,
    onError: fail,
  })
  const createExtra = api.money.createExtraWorkInvoice.useMutation({
    onSuccess: invalidate,
    onError: fail,
  })
  const isPending =
    createFixed.isPending ||
    createVisits.isPending ||
    createRecurring.isPending ||
    createExtra.isPending

  const amount = useMemo(() => {
    if (billing.basis !== 'fixed_contract') return 0
    if (fixedChoice === 'remaining') return billing.remaining
    if (fixedChoice.startsWith('installment:')) {
      const installmentId = fixedChoice.slice('installment:'.length)
      return billing.installments.find((item) => item.id === installmentId)?.amount ?? 0
    }
    const entered = inputValue ?? 0
    return fixedChoice === 'percentage'
      ? Math.round((billing.billingAmount * (inputValue ?? 0)) / 100)
      : entered
  }, [billing, fixedChoice, inputValue])

  const isExtra = mode === 'extra'
  const canContinue = isExtra
    ? selectedExtraAmount(billing, visitIds) > 0
    : billing.basis === 'per_visit'
      ? visitIds.length > 0
      : billing.basis === 'fixed_contract'
        ? amount > 0 && amount <= billing.remaining
        : true

  const submit = () => {
    if (!workOrderRecordId) return
    if (isExtra) {
      createExtra.mutate({ workOrderRecordId, visitIds })
      return
    }
    if (billing.basis === 'per_visit') {
      createVisits.mutate({ workOrderRecordId, visitIds })
      return
    }
    if (billing.basis === 'recurring_flat') {
      createRecurring.mutate({ workOrderRecordId })
      return
    }

    const fixedAmount =
      fixedChoice === 'remaining'
        ? ({ type: 'remaining' } as const)
        : fixedChoice === 'percentage'
          ? ({ type: 'percentage', value: inputValue ?? 0 } as const)
          : fixedChoice === 'fixed'
            ? ({ type: 'fixed', amount: inputValue ?? 0 } as const)
            : ({
                type: 'installment',
                installmentId: fixedChoice.slice('installment:'.length),
              } as const)
    createFixed.mutate({ workOrderRecordId, amount: fixedAmount })
  }

  const title = isBatch
    ? 'Batch invoice'
    : isExtra
      ? 'Invoice extra work'
      : billing.basis === 'fixed_contract'
        ? 'Create contract invoice'
        : billing.basis === 'per_visit'
          ? 'Create visit invoice'
          : 'Generate recurring charge'

  const description = isBatch
    ? 'Preview and create draft invoices for every qualifying work order in a period.'
    : 'Review the billable work before creating an editable draft.'

  const crumbs = isBatch
    ? [
        {
          label: 'Period & filters',
          onClick: page !== 'scope' ? () => setPage('scope') : undefined,
        },
        ...(page === 'preview' || page === 'generate'
          ? [
              {
                label: 'Preview',
                onClick: page === 'generate' ? () => setPage('preview') : undefined,
              },
            ]
          : []),
        ...(page === 'generate' ? [{ label: 'Results' }] : []),
      ]
    : [{ label: page === 'choose' ? chooseLabel(billing, isExtra) : 'Review' }]

  const onBack = isBatch
    ? page === 'preview'
      ? () => setPage('scope')
      : undefined
    : page === 'review'
      ? () => setPage('choose')
      : undefined

  const previewRows = previewBatch.data?.rows ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav title={title} description={description} onBack={onBack} crumbs={crumbs} />
        <DialogNavPages value={page}>
          {isBatch ? (
            <>
              <DialogNavPage value='scope' size='md'>
                <BatchScopePage
                  range={batchRange}
                  onRangeChange={setBatchRange}
                  filters={batchFilters}
                  onFiltersChange={setBatchFilters}
                  onCancel={() => onOpenChange(false)}
                  onContinue={() => setPage('preview')}
                />
              </DialogNavPage>
              <DialogNavPage value='preview' size='lg'>
                <BatchPreviewPage
                  rows={previewRows}
                  isLoading={previewBatch.isLoading}
                  selectedIds={batchSelectedIds}
                  onToggle={(id, checked) =>
                    setBatchSelectedIds((current) => {
                      const next = new Set(current)
                      if (checked) next.add(id)
                      else next.delete(id)
                      return next
                    })
                  }
                  onCancel={() => onOpenChange(false)}
                  onGenerate={submitBatch}
                  canGenerate={batchSelectedIds.size > 0}
                />
              </DialogNavPage>
              <DialogNavPage value='generate' size='md'>
                <BatchGeneratePage
                  isPending={runBatch.isPending}
                  results={runBatch.data?.results}
                  error={runBatch.error?.message}
                  rowLabelByWorkOrderId={rowLabelByWorkOrderId}
                  invoiceEntityDefinitionId={invoiceResource?.id}
                  onClose={() => onOpenChange(false)}
                />
              </DialogNavPage>
            </>
          ) : (
            <>
              <DialogNavPage value='choose' size='md'>
                <div className='space-y-4 p-4'>
                  {isExtra ? (
                    <ExtraWorkPicker billing={billing} value={visitIds} onChange={setVisitIds} />
                  ) : billing.basis === 'per_visit' ? (
                    <VisitPicker billing={billing} value={visitIds} onChange={setVisitIds} />
                  ) : billing.basis === 'fixed_contract' ? (
                    <FixedAmountPicker
                      billing={billing}
                      choice={fixedChoice}
                      onChoice={setFixedChoice}
                      inputValue={inputValue}
                      onInputValue={setInputValue}
                    />
                  ) : (
                    <FieldPanel orientation='horizontal' defaultLabelWidth={160} className='p-0'>
                      <PreviewRow
                        label='Recurring charge'
                        value={formatCurrency(billing.billingAmount, billing.currencyCode)}
                      />
                    </FieldPanel>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => onOpenChange(false)}>
                    Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={!canContinue}
                    onClick={() => setPage('review')}
                    data-dialog-submit>
                    Review <KbdSubmit variant='outline' size='sm' />
                  </Button>
                </DialogFooter>
              </DialogNavPage>
              <DialogNavPage value='review' size='md'>
                <div className='space-y-3 p-4 text-sm'>
                  <FieldPanel orientation='horizontal' defaultLabelWidth={170} className='p-0'>
                    <PreviewRow
                      label='Amount on this invoice'
                      value={formatCurrency(
                        amount ||
                          (isExtra
                            ? selectedExtraAmount(billing, visitIds)
                            : selectedVisitAmount(billing, visitIds)),
                        billing.currencyCode
                      )}
                    />
                    {billing.basis === 'fixed_contract' && !isExtra && (
                      <>
                        <PreviewRow
                          label='Contract value'
                          value={formatCurrency(billing.billingAmount, billing.currencyCode)}
                        />
                        <PreviewRow
                          label='Remaining after draft'
                          value={formatCurrency(
                            Math.max(0, billing.remaining - amount),
                            billing.currencyCode
                          )}
                        />
                      </>
                    )}
                    {(isExtra || billing.basis === 'per_visit') && (
                      <PreviewRow label='Visits included' value={String(visitIds.length)} />
                    )}
                  </FieldPanel>
                  <p className='text-xs text-muted-foreground'>
                    Tax and document discounts are calculated when the draft is created.
                  </p>
                </div>
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
                    variant='outline'
                    size='sm'
                    loading={isPending}
                    loadingText='Creating...'
                    onClick={submit}
                    data-dialog-submit>
                    Create draft <KbdSubmit variant='outline' size='sm' />
                  </Button>
                </DialogFooter>
              </DialogNavPage>
            </>
          )}
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}

function FixedAmountPicker({
  billing,
  choice,
  onChoice,
  inputValue,
  onInputValue,
}: {
  billing: WorkOrderBillingView
  choice: FixedChoice
  onChoice: (choice: FixedChoice) => void
  inputValue: number | null
  onInputValue: (value: number | null) => void
}) {
  const pendingInstallments = billing.installments.filter((item) => item.status === 'pending')

  return (
    <div className='space-y-3'>
      <RadioGroup
        value={choice}
        onValueChange={(value) => onChoice(value as FixedChoice)}
        className='gap-2'>
        <RadioGroupItemCard
          value='remaining'
          label='Remaining balance'
          description={formatCurrency(billing.remaining, billing.currencyCode)}
          icon={<ReceiptText />}
        />
        <RadioGroupItemCard
          value='percentage'
          label='Percentage'
          description='Percentage of the full contract value'
          icon={<Percent />}
        />
        <RadioGroupItemCard
          value='fixed'
          label='Fixed amount'
          description='Enter an amount before tax'
          icon={<CircleDollarSign />}
        />
        {pendingInstallments.map((item) => (
          <RadioGroupItemCard
            key={item.id}
            value={`installment:${item.id}`}
            label={item.name}
            sublabel={
              item.scheduledDate ? format(new Date(item.scheduledDate), 'PP') : 'Scheduled payment'
            }
            description={formatCurrency(item.amount, billing.currencyCode)}
            icon={<CalendarClock />}
          />
        ))}
      </RadioGroup>

      {(choice === 'percentage' || choice === 'fixed') && (
        <FieldPanel
          orientation='responsive'
          breakpoint='md'
          resizeId='billing-action-amount'
          defaultLabelWidth={160}
          className='p-0'>
          {choice === 'percentage' ? (
            <FieldPanelRow title='Percentage' type={BaseType.NUMBER} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={inputValue}
                onChange={(value) => onInputValue(value as number | null)}
                placeholder='25'
              />
            </FieldPanelRow>
          ) : (
            <FieldPanelRow title='Amount before tax' type={BaseType.CURRENCY} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.CURRENCY}
                fieldOptions={{
                  currencyCode: billing.currencyCode,
                  decimals: 2,
                  useGrouping: true,
                }}
                value={inputValue}
                onChange={(value) => onInputValue(value as number | null)}
                placeholder='0.00'
              />
            </FieldPanelRow>
          )}
        </FieldPanel>
      )}
    </div>
  )
}

function VisitPicker({
  billing,
  value,
  onChange,
}: {
  billing: WorkOrderBillingView
  value: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div className='space-y-2'>
      {billing.eligibleVisits.length === 0 ? (
        <p className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No completed visits are ready to invoice.
        </p>
      ) : (
        <FieldPanel
          orientation='responsive'
          resizeId='billing-action-visits'
          defaultLabelWidth={200}
          className='p-0'>
          {billing.eligibleVisits.map((visit) => (
            <FieldPanelRow
              key={visit.id}
              title={visit.label}
              description={[
                formatCurrency(visit.amount, billing.currencyCode),
                visit.serviceDate
                  ? `Service date: ${format(new Date(visit.serviceDate), 'PP')}`
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}>
              <FieldInputAdapter
                fieldType={FieldType.CHECKBOX}
                value={value.includes(visit.id)}
                onChange={(checked) =>
                  onChange(checked ? [...value, visit.id] : value.filter((id) => id !== visit.id))
                }
              />
            </FieldPanelRow>
          ))}
        </FieldPanel>
      )}
    </div>
  )
}

interface ExtraWorkVisitGroup {
  visitId: string
  visitStatus: string
  serviceDate?: string | null
  amount: number
  lineNames: string[]
}

/** Group billable extras by visit, preserving the server's visit-date ordering. */
function groupExtraWorkByVisit(billing: WorkOrderBillingView): ExtraWorkVisitGroup[] {
  const groups = new Map<string, ExtraWorkVisitGroup>()
  for (const row of billing.extraWork) {
    const group = groups.get(row.visitId) ?? {
      visitId: row.visitId,
      visitStatus: row.visitStatus,
      serviceDate: row.serviceDate,
      amount: 0,
      lineNames: [],
    }
    group.amount += row.amount
    if (row.name) group.lineNames.push(row.name)
    groups.set(row.visitId, group)
  }
  return [...groups.values()]
}

function ExtraWorkPicker({
  billing,
  value,
  onChange,
}: {
  billing: WorkOrderBillingView
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const groups = groupExtraWorkByVisit(billing)
  const done = groups.filter((group) => group.visitStatus === 'done')
  const upcoming = groups.filter((group) => group.visitStatus !== 'done')

  if (groups.length === 0) {
    return (
      <p className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
        No extra work is ready to invoice.
      </p>
    )
  }

  const renderRow = (group: ExtraWorkVisitGroup, upcomingRow: boolean) => (
    <FieldPanelRow
      key={group.visitId}
      title={group.serviceDate ? format(new Date(group.serviceDate), 'PP') : 'Unscheduled visit'}
      description={[
        formatCurrency(group.amount, billing.currencyCode),
        upcomingRow ? 'Visit not yet done' : undefined,
        group.lineNames.join(', ') || undefined,
      ]
        .filter(Boolean)
        .join(' · ')}>
      <FieldInputAdapter
        fieldType={FieldType.CHECKBOX}
        value={value.includes(group.visitId)}
        onChange={(checked) =>
          onChange(checked ? [...value, group.visitId] : value.filter((id) => id !== group.visitId))
        }
      />
    </FieldPanelRow>
  )

  return (
    <div className='space-y-3'>
      {done.length > 0 && (
        <FieldPanel
          orientation='responsive'
          resizeId='billing-action-extras'
          defaultLabelWidth={200}
          className='p-0'>
          {done.map((group) => renderRow(group, false))}
        </FieldPanel>
      )}
      {upcoming.length > 0 && (
        <div className='space-y-1.5'>
          <p className='px-1 text-xs text-muted-foreground'>Not yet done</p>
          <FieldPanel
            orientation='responsive'
            resizeId='billing-action-extras-upcoming'
            defaultLabelWidth={200}
            className='p-0'>
            {upcoming.map((group) => renderRow(group, true))}
          </FieldPanel>
        </div>
      )}
    </div>
  )
}

export function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <FieldPanelRow title={label}>
      <div className='flex min-h-8 items-center justify-end px-2 font-medium tabular-nums'>
        {value}
      </div>
    </FieldPanelRow>
  )
}

function selectedVisitAmount(billing: WorkOrderBillingView, ids: string[]) {
  return billing.eligibleVisits
    .filter((visit) => ids.includes(visit.id))
    .reduce((sum, visit) => sum + visit.amount, 0)
}

function selectedExtraAmount(billing: WorkOrderBillingView, ids: string[]) {
  return billing.extraWork
    .filter((row) => ids.includes(row.visitId))
    .reduce((sum, row) => sum + row.amount, 0)
}

function chooseLabel(billing: WorkOrderBillingView, extra: boolean) {
  if (extra || billing.basis === 'per_visit') return 'Select visits'
  if (billing.basis === 'fixed_contract') return 'Choose amount'
  return 'Recurring charge'
}
