// apps/web/src/components/money/billing/batch-invoice-pages.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { getFieldOperators } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import type { DateRange } from '@auxx/ui/components/date-range-picker'
import { DateRangePicker } from '@auxx/ui/components/date-range-picker'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Switch } from '@auxx/ui/components/switch'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { addMonths, endOfMonth, isSameDay, startOfMonth } from 'date-fns'
import { CheckCircle2, Printer, Receipt, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Condition, ConditionSystemConfig } from '~/components/conditions'
import { ConditionContainer, ConditionProvider } from '~/components/conditions'
import { ExportProgressDialog } from '~/components/data-export/ui/export-progress-dialog'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { PrintWizardDialog } from '~/components/print/ui/print-wizard-dialog'
import { useResource, useResourceFields } from '~/components/resources'
import type { RouterOutputs } from '~/trpc/react'
import { PreviewRow } from './billing-action-dialog'

type BatchRow = RouterOutputs['money']['previewInvoiceBatch']['rows'][number]
type BatchRunResult = RouterOutputs['money']['runInvoiceBatch']['results'][number]

/** Batch amounts don't carry a currency code (plan §3 — `previewInvoiceBatch` doesn't return
 * one); the batch scope is single-org, single-currency in v1, so this mirrors the fallback
 * `WorkOrderBillingView.currencyCode` default used elsewhere in this dialog. */
const BATCH_CURRENCY = 'USD'

const BASIS_LABELS: Record<BatchRow['basis'], string> = {
  fixed_contract: 'Fixed contract',
  per_visit: 'Per visit',
  recurring_flat: 'Recurring',
}

function countLabel(row: BatchRow): string | undefined {
  if (row.visitCount !== undefined)
    return `${row.visitCount} visit${row.visitCount === 1 ? '' : 's'}`
  if (row.occurrenceCount !== undefined) {
    return `${row.occurrenceCount} occurrence${row.occurrenceCount === 1 ? '' : 's'}`
  }
  return undefined
}

const EMPTY_CONDITIONS: Condition[] = []

interface BatchScopePageProps {
  range: DateRange
  onRangeChange: (range: DateRange) => void
  filters: ConditionGroup[]
  onFiltersChange: (filters: ConditionGroup[]) => void
  onCancel: () => void
  onContinue: () => void
}

/** Batch page 1 — period + condition-builder scope (plan §3, batch page `scope`). Filters embed
 * the shared condition system directly (no popover buffering — this is already a dialog page). */
export function BatchScopePage({
  range,
  onRangeChange,
  filters,
  onFiltersChange,
  onCancel,
  onContinue,
}: BatchScopePageProps) {
  const { resource } = useResource('work-orders')
  const entityDefinitionId = resource?.id
  const { filterableFields } = useResourceFields(entityDefinitionId)

  const fieldDefinitions = useMemo(
    () =>
      filterableFields.map((field) => ({
        id: field.resourceFieldId ?? field.id,
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
        operators: field.operatorOverrides || getFieldOperators(field),
        options: field.options,
      })),
    [filterableFields]
  )

  const config: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      entityDefinitionId: entityDefinitionId ?? '',
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      defaultGroupName: 'Filter',
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: true,
    }),
    [fieldDefinitions, entityDefinitionId]
  )

  const thisMonthStart = startOfMonth(new Date())
  const nextMonthStart = addMonths(thisMonthStart, 1)
  const isThisMonth =
    isSameDay(range.from, thisMonthStart) && isSameDay(range.to, endOfMonth(thisMonthStart))
  const isNextMonth =
    isSameDay(range.from, nextMonthStart) && isSameDay(range.to, endOfMonth(nextMonthStart))

  return (
    <>
      <div className='space-y-4 p-4'>
        <FieldPanel orientation='horizontal' defaultLabelWidth={100} className='p-0'>
          <FieldPanelRow title='Period'>
            <div className='flex flex-wrap items-center gap-2 px-2 py-1'>
              <Button
                type='button'
                size='sm'
                variant={isThisMonth ? 'secondary' : 'ghost'}
                onClick={() =>
                  onRangeChange({ from: thisMonthStart, to: endOfMonth(thisMonthStart) })
                }>
                This month
              </Button>
              <Button
                type='button'
                size='sm'
                variant={isNextMonth ? 'secondary' : 'ghost'}
                onClick={() =>
                  onRangeChange({ from: nextMonthStart, to: endOfMonth(nextMonthStart) })
                }>
                Next month
              </Button>
              <DateRangePicker value={range} onChange={onRangeChange} showPresets={false} />
            </div>
          </FieldPanelRow>
        </FieldPanel>
        <div className='space-y-1.5'>
          <p className='px-1 text-xs text-muted-foreground'>Filters</p>
          {entityDefinitionId ? (
            <ConditionProvider
              conditions={EMPTY_CONDITIONS}
              groups={filters}
              config={config}
              onConditionsChange={() => {}}
              onGroupsChange={onFiltersChange}
              getAvailableFields={() => fieldDefinitions}
              getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
              <ConditionContainer
                emptyStateText='All qualifying work orders will be included — add a filter to narrow'
                showAddButton
                showGrouping
              />
            </ConditionProvider>
          ) : (
            <p className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
              Loading work order fields…
            </p>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button variant='outline' size='sm' onClick={onContinue} data-dialog-submit>
          Preview <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </>
  )
}

interface BatchPreviewPageProps {
  rows: BatchRow[]
  isLoading: boolean
  selectedIds: Set<RecordId>
  onToggle: (id: RecordId, checked: boolean) => void
  onCancel: () => void
  onGenerate: () => void
  canGenerate: boolean
}

/** Batch page 2 — per-work-order checkbox preview (plan §3, batch page `preview`). Excluded
 * rows (fixed-contract, no custom schedule) render greyed with their reason, no checkbox. */
export function BatchPreviewPage({
  rows,
  isLoading,
  selectedIds,
  onToggle,
  onCancel,
  onGenerate,
  canGenerate,
}: BatchPreviewPageProps) {
  const includable = rows.filter((row) => !row.excludedReason)
  const excluded = rows.filter((row) => row.excludedReason)
  const selectedRows = includable.filter((row) => selectedIds.has(row.workOrderRecordId))
  const selectedAmount = selectedRows.reduce((sum, row) => sum + row.amount, 0)

  return (
    <>
      <div className='space-y-3 p-4'>
        {!isLoading && rows.length === 0 ? (
          <p className='rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
            No work orders have anything due in this period.
          </p>
        ) : (
          <>
            <TreeRowList
              items={[...includable, ...excluded]}
              getKey={(row) => row.workOrderRecordId}
              loading={isLoading}
              skeletonCount={4}
              renderRow={(row) =>
                row.excludedReason ? (
                  <TreeRow
                    rowClassName='opacity-60'
                    icon={<Receipt className='size-4' />}
                    title={<span className='text-sm'>{row.contactName ?? 'Work order'}</span>}
                    secondary={
                      <span className='text-xs'>
                        {[BASIS_LABELS[row.basis], row.excludedReason].filter(Boolean).join(' · ')}
                      </span>
                    }
                  />
                ) : (
                  <TreeRow
                    rowClassName='hover:bg-primary-100'
                    icon={<Receipt className='size-4' />}
                    title={<span className='text-sm'>{row.contactName ?? 'Work order'}</span>}
                    secondary={
                      <span className='text-xs'>
                        {[
                          BASIS_LABELS[row.basis],
                          countLabel(row),
                          formatCurrency(row.amount, BATCH_CURRENCY),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    }
                    trailing={
                      <Switch
                        size='xs'
                        checked={selectedIds.has(row.workOrderRecordId)}
                        onCheckedChange={(checked) => onToggle(row.workOrderRecordId, checked)}
                      />
                    }
                  />
                )
              }
            />
            {!isLoading && (
              <FieldPanel orientation='horizontal' defaultLabelWidth={170} className='p-0'>
                <PreviewRow
                  label='Selected'
                  value={`${selectedRows.length} of ${includable.length}`}
                />
                <PreviewRow label='Total' value={formatCurrency(selectedAmount, BATCH_CURRENCY)} />
              </FieldPanel>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={!canGenerate}
          onClick={onGenerate}
          data-dialog-submit>
          Generate {selectedRows.length} draft{selectedRows.length === 1 ? '' : 's'}{' '}
          <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </>
  )
}

interface BatchGeneratePageProps {
  isPending: boolean
  results: BatchRunResult[] | undefined
  error: string | undefined
  rowLabelByWorkOrderId: Map<string, string>
  invoiceEntityDefinitionId: string | undefined
  onClose: () => void
}

/** Batch page 3 — run results (plan §3, batch page `generate`). The "Print…" handoff opens the
 * unified print wizard pinned to the created invoices' selection scope. */
export function BatchGeneratePage({
  isPending,
  results,
  error,
  rowLabelByWorkOrderId,
  invoiceEntityDefinitionId,
  onClose,
}: BatchGeneratePageProps) {
  const [printOpen, setPrintOpen] = useState(false)
  const [printJobId, setPrintJobId] = useState<string | null>(null)
  const [printProgressOpen, setPrintProgressOpen] = useState(false)

  const createdRecordIds = useMemo(() => {
    if (!results) return []
    return results.flatMap(
      (item) => item.invoiceRecordIds ?? (item.invoiceRecordId ? [item.invoiceRecordId] : [])
    )
  }, [results])

  return (
    <>
      <div className='space-y-3 p-4'>
        {error ? (
          <p className='rounded-lg border border-dashed p-4 text-center text-sm text-bad-500'>
            {error}
          </p>
        ) : isPending || !results ? (
          <p className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
            Generating draft invoices…
          </p>
        ) : (
          <>
            <FieldPanel orientation='horizontal' defaultLabelWidth={220} className='p-0'>
              {results.map((item) => (
                <FieldPanelRow
                  key={item.workOrderRecordId}
                  title={rowLabelByWorkOrderId.get(item.workOrderRecordId) ?? 'Work order'}>
                  <div className='flex min-h-8 items-center gap-2 px-2 text-sm'>
                    {item.ok ? (
                      <>
                        <CheckCircle2 className='size-4 text-good-500' />
                        <span className='text-muted-foreground'>Draft created</span>
                      </>
                    ) : (
                      <>
                        <XCircle className='size-4 text-bad-500' />
                        <span className='text-bad-500'>{item.error ?? 'Failed'}</span>
                      </>
                    )}
                  </div>
                </FieldPanelRow>
              ))}
            </FieldPanel>
            {createdRecordIds.length > 0 && (
              <p className='text-xs text-muted-foreground'>
                {createdRecordIds.length} draft{createdRecordIds.length === 1 ? '' : 's'} created on{' '}
                <span className='font-medium'>/app/invoices</span>.
              </p>
            )}
          </>
        )}
      </div>
      <DialogFooter>
        {createdRecordIds.length > 0 && invoiceEntityDefinitionId && (
          <Button type='button' variant='ghost' size='sm' onClick={() => setPrintOpen(true)}>
            <Printer />
            Print…
          </Button>
        )}
        <Button
          variant='outline'
          size='sm'
          disabled={isPending || (!results && !error)}
          onClick={onClose}
          data-dialog-submit>
          Done <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
      {invoiceEntityDefinitionId && printOpen && (
        <PrintWizardDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          entityDefinitionId={invoiceEntityDefinitionId}
          tableId={`entity-${invoiceEntityDefinitionId}`}
          selection={{ recordIds: createdRecordIds }}
          onCreated={(jobId) => {
            setPrintJobId(jobId)
            setPrintProgressOpen(true)
          }}
        />
      )}
      {printJobId && (
        <ExportProgressDialog
          jobId={printJobId}
          open={printProgressOpen}
          onOpenChange={setPrintProgressOpen}
        />
      )}
    </>
  )
}
