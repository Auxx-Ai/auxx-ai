// apps/web/src/components/purchasing/vendor-bill/add-bill-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import {
  BILL_INTAKE_PHASE_LABELS,
  BILL_INTAKE_PHASES,
  type BillIntakePhase,
  type BillIntakeRunView,
} from '@auxx/lib/accounting/purchasing/bill-intake/client'
import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RelationshipConfig, SelectOption } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError } from '@auxx/ui/components/toast'
import { formatCurrency } from '@auxx/utils/currency'
import { formatBytes } from '@auxx/utils/file'
import { Check, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FileSelectDropZone } from '~/components/file-select/file-select-drop-zone'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { MultiSelectPicker } from '~/components/pickers/multi-select-picker'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecords, useResourceFields } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { BaseType } from '~/components/workflow/types'
import { useDebouncedValue } from '~/hooks/use-debounced-value'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { useDocumentUpload } from '../intake/hooks/use-quote-upload'
import { numberValue, PurchasingSummaryStrip, unwrapValue } from '../purchasing-summary-strip'
import { ManualBillForm } from './manual-bill-form'

type Page = 'choose' | 'manual' | 'upload' | 'reading'
type EntryMethod = 'manual' | 'upload'

const FILE_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
  '.csv',
  '.xlsx',
  '.xls',
  '.docx',
  '.txt',
  '.eml',
]

const VENDOR_RELATIONSHIP: RelationshipConfig = {
  inverseResourceFieldId: toResourceFieldId('company', 'id'),
  relationshipType: 'belongs_to',
  isInverse: false,
}

export interface AddBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrderRecordId?: RecordId
  vendorRecordId?: RecordId
  onCreated?: (billRecordId: RecordId) => void
}

/** Add a bill manually or read one invoice through the bill-intake worker. */
export function AddBillDialog({
  open,
  onOpenChange,
  purchaseOrderRecordId: initialOrder,
  vendorRecordId: initialVendor,
  onCreated,
}: AddBillDialogProps) {
  const router = useRouter()
  const openRecord = useOpenRecord()
  const [page, setPage] = useState<Page>('choose')
  const [entryMethod, setEntryMethod] = useState<EntryMethod>('manual')
  const [vendorRecordId, setVendorRecordId] = useState<RecordId | null>(initialVendor ?? null)
  const [purchaseOrderRecordId, setPurchaseOrderRecordId] = useState<RecordId | null>(
    initialOrder ?? null
  )
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)

  const { fields: billFields } = useResourceFields('vendor_bill')
  const documentFieldId = useMemo(
    () => billFields.find((field) => field.systemAttribute === 'vendor_bill_document')?.id ?? '',
    [billFields]
  )
  const { upload, cancel, isUploading } = useDocumentUpload({ fieldRef: documentFieldId })
  const capability = api.purchasing.intakeModelCapability.useQuery(undefined, { enabled: open })
  const startIntake = api.purchasing.startBillIntake.useMutation()
  const resumeIntake = api.purchasing.resumeBillIntake.useMutation()
  const runQuery = api.purchasing.getBillIntakeRun.useQuery(
    { runId: runId ?? '' },
    {
      enabled: Boolean(runId) && page === 'reading',
      refetchInterval: (query) => (query.state.data?.status === 'reading' ? 1500 : false),
    }
  )
  const openGeneration = useRef(0)

  // Picking an order supplies its vendor. The read is deliberately narrow: the
  // chooser only needs this one relationship and the order's other fields belong
  // to the manual form.
  const { values: selectedOrderValues } = useSystemValues(
    purchaseOrderRecordId,
    ['purchase_order_vendor'],
    { autoFetch: true, enabled: Boolean(purchaseOrderRecordId) }
  )
  const selectedOrderVendor =
    extractRelationshipRecordIds(selectedOrderValues.purchase_order_vendor)[0] ?? null

  useEffect(() => {
    if (
      open &&
      purchaseOrderRecordId &&
      selectedOrderVendor &&
      vendorRecordId !== selectedOrderVendor
    ) {
      setVendorRecordId(selectedOrderVendor)
    }
  }, [open, purchaseOrderRecordId, selectedOrderVendor, vendorRecordId])

  useEffect(() => {
    if (!open) return
    openGeneration.current += 1
    setPage('choose')
    setEntryMethod('manual')
    setVendorRecordId(initialVendor ?? null)
    setPurchaseOrderRecordId(initialOrder ?? null)
    setFile(null)
    setRunId(null)
  }, [open, initialOrder, initialVendor])

  const handleDialogChange = useCallback(
    (next: boolean) => {
      if (!next) {
        openGeneration.current += 1
        cancel()
      }
      onOpenChange(next)
    },
    [cancel, onOpenChange]
  )

  const run = runQuery.data as BillIntakeRunView | undefined
  useEffect(() => {
    if (!open || !run || page !== 'reading') return
    if (run.status === 'created' && run.vendorBillInstanceId) {
      const billRecordId = run.vendorBillRecordId ?? run.vendorBillInstanceId
      const instanceId = run.vendorBillInstanceId
      handleDialogChange(false)
      onCreated?.(billRecordId as RecordId)
      router.push(`/app/vendor-bills/${instanceId}`)
    }
  }, [open, run, page, onCreated, handleDialogChange, router])

  const chooseVendor = useCallback(
    (value: unknown) => {
      const next = (value as RecordId[] | undefined)?.[0] ?? null
      setVendorRecordId(next)
      if (!next || (selectedOrderVendor && selectedOrderVendor !== next))
        setPurchaseOrderRecordId(null)
    },
    [selectedOrderVendor]
  )

  const chooseOrder = useCallback((value: unknown) => {
    setPurchaseOrderRecordId((value as RecordId[] | undefined)?.[0] ?? null)
  }, [])

  const handleFilesSelected = useCallback((files: File[]) => {
    if (files[0]) setFile(files[0])
  }, [])

  const startReading = useCallback(async () => {
    if (!file || !capability.data?.ok) return
    const generation = openGeneration.current
    try {
      const uploaded = await upload(file)
      const started = await startIntake.mutateAsync({
        assetRef: uploaded.assetRef,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType ?? undefined,
        vendorRecordId: vendorRecordId ?? undefined,
        purchaseOrderRecordId: purchaseOrderRecordId ?? undefined,
      })
      if (generation !== openGeneration.current) return
      setRunId(started.runId)
      setPage('reading')
    } catch (error) {
      toastError({
        title: 'Could not read the invoice',
        description: error instanceof Error ? error.message : 'The invoice could not be uploaded.',
      })
    }
  }, [file, capability.data?.ok, upload, startIntake, vendorRecordId, purchaseOrderRecordId])

  const continueWithVendor = useCallback(
    async (selected: RecordId) => {
      if (!runId) return
      try {
        await resumeIntake.mutateAsync({ runId, vendorRecordId: selected })
        await runQuery.refetch()
      } catch (error) {
        toastError({
          title: 'Could not continue reading',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    },
    [runId, resumeIntake, runQuery]
  )

  const failed = run?.status === 'failed'
  const pending = isUploading || startIntake.isPending
  const pageTitle = PAGE_TITLES[page]
  const goToBill = (recordId: RecordId | string) => {
    const instanceId =
      typeof recordId === 'string' && recordId.includes(':') ? recordId.split(':').at(-1) : recordId
    if (instanceId) router.push(`/app/vendor-bills/${instanceId}`)
    handleDialogChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title='Add bill'
            description='Enter the supplier invoice or upload it to read the printed details.'
            onBack={
              page === 'manual' || page === 'upload' || failed ? () => setPage('choose') : undefined
            }
            crumbs={[{ label: 'Add bill' }, ...(page !== 'choose' ? [{ label: pageTitle }] : [])]}
          />
          <DialogNavPages value={page}>
            <DialogNavPage value='choose' size='md'>
              <ChoosePage
                vendorRecordId={vendorRecordId}
                purchaseOrderRecordId={purchaseOrderRecordId}
                onVendorChange={chooseVendor}
                onOrderChange={chooseOrder}
                entryMethod={entryMethod}
                onEntryMethodChange={setEntryMethod}
                uploadEnabled={capability.data?.ok === true}
                uploadReason={capability.data?.reason}
              />
            </DialogNavPage>
            <DialogNavPage value='manual' size='lg'>
              <ManualBillForm
                key={`${open}-${vendorRecordId ?? ''}-${purchaseOrderRecordId ?? ''}`}
                vendorRecordId={vendorRecordId}
                purchaseOrderRecordId={purchaseOrderRecordId}
                onBack={() => setPage('choose')}
                onCancel={() => handleDialogChange(false)}
                onCreated={(billRecordId) => {
                  handleDialogChange(false)
                  if (onCreated) onCreated(billRecordId)
                  else if (openRecord) openRecord(billRecordId)
                  else goToBill(billRecordId)
                }}
              />
            </DialogNavPage>
            <DialogNavPage value='upload' size='md'>
              <UploadPage
                file={file}
                dragActive={dragActive}
                onFilesSelected={handleFilesSelected}
                onDragActiveChange={setDragActive}
                onRemove={() => setFile(null)}
              />
            </DialogNavPage>
            <DialogNavPage value='reading' size='md'>
              <ReadingPage
                run={run}
                failed={failed}
                runError={runQuery.error instanceof Error ? runQuery.error.message : null}
                onRefresh={() => void runQuery.refetch()}
                onCandidate={continueWithVendor}
                onRetry={() => {
                  setFile(null)
                  setPage('upload')
                }}
                onOpenBill={
                  run?.existingBillRecordId ? () => goToBill(run.existingBillRecordId!) : undefined
                }
                resuming={resumeIntake.isPending}
              />
            </DialogNavPage>
          </DialogNavPages>
          {page !== 'manual' && (
            <DialogFooter className='mt-0 border-t p-3'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => handleDialogChange(false)}
                disabled={pending}>
                {page === 'reading' ? 'Close' : 'Cancel'}{' '}
                <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              {page === 'choose' && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setPage(entryMethod)}
                  disabled={entryMethod === 'upload' && !capability.data?.ok}
                  data-dialog-submit>
                  Continue <KbdSubmit variant='outline' size='sm' />
                </Button>
              )}
              {page === 'upload' && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => void startReading()}
                  loading={pending}
                  loadingText='Uploading...'
                  disabled={!file || !documentFieldId || !capability.data?.ok}
                  data-dialog-submit>
                  Read invoice <KbdSubmit variant='outline' size='sm' />
                </Button>
              )}
              {page === 'reading' && !failed && run?.status !== 'needs_vendor' && (
                <p className='text-muted-foreground self-center text-xs'>
                  The bill will appear in the list when it is ready.
                </p>
              )}
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ChoosePage({
  vendorRecordId,
  purchaseOrderRecordId,
  onVendorChange,
  onOrderChange,
  entryMethod,
  onEntryMethodChange,
  uploadEnabled,
  uploadReason,
}: {
  vendorRecordId: RecordId | null
  purchaseOrderRecordId: RecordId | null
  onVendorChange: (value: unknown) => void
  onOrderChange: (value: unknown) => void
  entryMethod: EntryMethod
  onEntryMethodChange: (value: EntryMethod) => void
  uploadEnabled: boolean
  uploadReason?: string | null
}) {
  const { getSetting } = useSettings({})
  const { values: orderValues } = useSystemValues(
    purchaseOrderRecordId,
    ['purchase_order_total', 'purchase_order_currency', 'purchase_order_bills'],
    { autoFetch: true, enabled: Boolean(purchaseOrderRecordId) }
  )
  const billIds = extractRelationshipRecordIds(orderValues.purchase_order_bills)
  const { valuesById: billValues, loadedById } = useSystemValuesForRecords(
    billIds,
    ['vendor_bill_total'],
    {
      autoFetch: true,
      enabled: billIds.length > 0,
    }
  )
  const billFiguresLoaded =
    billIds.length === 0 || billIds.every((id) => loadedById[id]?.vendor_bill_total)
  const currencyValue = unwrapValue(orderValues.purchase_order_currency)
  const currencyCode =
    (typeof currencyValue === 'string' && currencyValue) ||
    (getSetting('organization.currency') as string | null) ||
    'USD'
  const orderTotal = numberValue(orderValues.purchase_order_total)
  const billed = billIds.reduce(
    (sum, id) => sum + numberValue(billValues[id]?.vendor_bill_total),
    0
  )
  const unbilled = orderTotal - billed

  return (
    <div className='flex flex-col gap-4 p-3'>
      {purchaseOrderRecordId && billFiguresLoaded && (
        <PurchasingSummaryStrip
          cells={[
            { label: 'Order total', value: formatCurrency(orderTotal, { currencyCode }) },
            { label: 'Already billed', value: formatCurrency(billed, { currencyCode }) },
            {
              label: 'Unbilled',
              value: formatCurrency(unbilled, { currencyCode }),
              tone: unbilled === 0 ? 'muted' : 'default',
            },
          ]}
        />
      )}
      <FieldPanel
        orientation='responsive'
        breakpoint='md'
        resizeId='add-bill-choose'
        defaultLabelWidth={135}
        className='p-0'>
        <FieldPanelRow
          title='Vendor'
          type={BaseType.RELATION}
          showIcon
          description='Optional here; required when you save a bill'>
          <FieldInputAdapter
            fieldType={FieldType.RELATIONSHIP}
            value={vendorRecordId ? [vendorRecordId] : []}
            onChange={onVendorChange}
            placeholder='Select a vendor...'
            triggerProps={{ className: 'w-full ps-0 pe-1' }}
            fieldOptions={{
              relationship: VENDOR_RELATIONSHIP,
              showDefinitionIcon: true,
              showSecondary: true,
            }}
            allowMultiple={false}
          />
        </FieldPanelRow>
        <FieldPanelRow
          title='Purchase order'
          type={BaseType.RELATION}
          showIcon
          description='Optional; only open orders are shown, filtered by vendor'>
          <PurchaseOrderPicker
            vendorRecordId={vendorRecordId}
            value={purchaseOrderRecordId}
            onChange={onOrderChange}
          />
        </FieldPanelRow>
      </FieldPanel>
      <RadioGroup
        aria-label='Bill entry method'
        value={entryMethod}
        onValueChange={(value) => onEntryMethodChange(value as EntryMethod)}
        className='grid gap-2 sm:grid-cols-2'>
        <RadioGroupItemCard
          id='bill-entry-manual'
          value='manual'
          label='Enter by hand'
          description='Type the invoice details and add the bill now.'
        />
        <RadioGroupItemCard
          id='bill-entry-upload'
          value='upload'
          label='From the invoice'
          description='Upload one document and read its printed details.'
          disabled={!uploadEnabled}
        />
      </RadioGroup>
      {!uploadEnabled && (
        <p className='text-muted-foreground text-xs'>
          {uploadReason ?? 'Document reading is not available.'}
        </p>
      )}
    </div>
  )
}

function UploadPage({
  file,
  dragActive,
  onFilesSelected,
  onDragActiveChange,
  onRemove,
}: {
  file: File | null
  dragActive: boolean
  onFilesSelected: (files: File[]) => void
  onDragActiveChange: (active: boolean) => void
  onRemove: () => void
}) {
  return (
    <div className='flex flex-col gap-3 p-3'>
      {!file ? (
        <FileSelectDropZone
          onFilesSelected={onFilesSelected}
          onBrowseExisting={() => {}}
          dragActive={dragActive}
          onDragActiveChange={onDragActiveChange}
          maxFiles={1}
          fileExtensions={FILE_EXTENSIONS}
          accept={['image/*', ...FILE_EXTENSIONS].join(',')}
          placeholder='Drop the invoice here or click to select'
          showFilePicker={false}
          className='min-h-[180px]'
        />
      ) : (
        <div className='flex items-center justify-between gap-3 rounded-xl border p-4'>
          <div className='flex min-w-0 items-center gap-3'>
            <EntityIcon iconId='file-text' variant='muted' />
            <div className='min-w-0'>
              <p className='truncate font-medium text-sm'>{file.name}</p>
              <p className='text-muted-foreground text-sm'>{formatBytes(file.size)}</p>
            </div>
          </div>
          <Button variant='destructive-hover' size='icon-sm' onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      )}
      <p className='text-muted-foreground text-xs'>
        One document per invoice. PDFs, images and spreadsheets are supported.
      </p>
    </div>
  )
}

/** Search the PO list, then keep only open orders for the selected vendor. */
function PurchaseOrderPicker({
  vendorRecordId,
  value,
  onChange,
}: {
  vendorRecordId: RecordId | null
  value: RecordId | null
  onChange: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const filters = useMemo(
    () => [
      {
        id: 'bill-order-open',
        logicalOperator: 'AND' as const,
        conditions: [
          {
            id: 'bill-order-status',
            fieldId: 'purchase_order:status',
            operator: 'not in',
            value: ['closed', 'canceled'],
          },
          ...(vendorRecordId
            ? [
                {
                  id: 'bill-order-vendor',
                  fieldId: 'purchase_order:vendor',
                  operator: 'is',
                  value: vendorRecordId,
                },
              ]
            : []),
        ],
      },
    ],
    [vendorRecordId]
  )
  const listQuery = api.record.listFiltered.useQuery(
    {
      entityDefinitionId: 'purchase_order',
      filters,
      search: debouncedSearch || undefined,
      limit: 50,
    },
    { enabled: open }
  )
  const resultIds = useMemo(
    () => (listQuery.data?.ids ?? []).map((id) => toRecordId('purchase_order', id)),
    [listQuery.data]
  )
  const { records, isLoading: recordsLoading } = useRecords({
    recordIds: resultIds,
    enabled: resultIds.length > 0,
  })
  const options: SelectOption[] = useMemo(
    () =>
      resultIds.map((recordId, index) => ({
        label: records[index]?.displayName ?? 'Untitled purchase order',
        value: recordId,
      })),
    [resultIds, records]
  )
  const selected = value ? [value] : []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          variant='transparent'
          className='h-auto min-h-8 w-full ps-0 pe-1'
          hasValue={Boolean(value)}
          placeholder={vendorRecordId ? 'Select an open order...' : 'Select an open order...'}
          showClear={Boolean(value)}
          onClear={(event) => {
            event.stopPropagation()
            onChange([])
          }}
          asCombobox>
          {value && <RecordBadge recordId={value} />}
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent
        className='min-w-[max(var(--radix-popover-trigger-width),22rem)] p-0'
        align='start'>
        <MultiSelectPicker
          options={options}
          value={selected}
          onChange={(next) => {
            onChange(next)
            setOpen(false)
          }}
          onSearchChange={setSearch}
          isLoading={listQuery.isLoading || recordsLoading}
          multi={false}
          canAdd={false}
          canManage={false}
          placeholder='Search open purchase orders...'
        />
      </PopoverContent>
    </Popover>
  )
}

function ReadingPage({
  run,
  failed,
  runError,
  onRefresh,
  onCandidate,
  onRetry,
  onOpenBill,
  resuming,
}: {
  run?: BillIntakeRunView
  failed: boolean
  runError: string | null
  onRefresh: () => void
  onCandidate: (recordId: RecordId) => void
  onRetry: () => void
  onOpenBill?: () => void
  resuming: boolean
}) {
  const [selectedVendor, setSelectedVendor] = useState<RecordId | null>(null)
  const needsVendor = run?.status === 'needs_vendor'
  return (
    <div className='flex flex-col gap-3 p-3'>
      <ul className='flex flex-col gap-2'>
        {BILL_INTAKE_PHASES.map((phase) => (
          <PhaseRow
            key={phase}
            phase={phase}
            current={run?.phase ?? null}
            done={run?.status === 'created'}
            failed={failed}
          />
        ))}
      </ul>
      {needsVendor && (
        <div className='flex flex-col gap-2 rounded-xl border p-3'>
          <p className='font-medium text-sm'>Choose the vendor for this invoice</p>
          <p className='text-muted-foreground text-xs'>
            The invoice name matched more than one company, so choose the one it belongs to.
          </p>
          <div className='flex flex-col gap-1'>
            {run.vendorCandidates.map((candidate) => (
              <Button
                key={candidate.recordId}
                variant={selectedVendor === candidate.recordId ? 'secondary' : 'ghost'}
                className='h-auto justify-start py-2 text-left'
                onClick={() => setSelectedVendor(candidate.recordId)}>
                <span className='flex flex-col items-start'>
                  <span>{candidate.displayName}</span>
                  {candidate.secondary && (
                    <span className='text-muted-foreground text-xs'>{candidate.secondary}</span>
                  )}
                </span>
              </Button>
            ))}
          </div>
          <FieldInputAdapter
            fieldType={FieldType.RELATIONSHIP}
            value={selectedVendor ? [selectedVendor] : []}
            onChange={(value) => setSelectedVendor((value as RecordId[] | undefined)?.[0] ?? null)}
            placeholder='Search vendors...'
            fieldOptions={{
              relationship: VENDOR_RELATIONSHIP,
              showDefinitionIcon: true,
              showSecondary: true,
            }}
            allowMultiple={false}
          />
          <Button
            variant='outline'
            size='sm'
            onClick={() => selectedVendor && onCandidate(selectedVendor)}
            loading={resuming}
            disabled={!selectedVendor}>
            Continue <KbdSubmit variant='outline' size='sm' />
          </Button>
        </div>
      )}
      {failed && (
        <Alert variant='destructive'>
          <TriangleAlert className='size-4' />
          <AlertTitle>We could not read that invoice</AlertTitle>
          <AlertDescription>{run?.error ?? 'The invoice could not be read.'}</AlertDescription>
        </Alert>
      )}
      {runError && !failed && (
        <Alert variant='destructive'>
          <TriangleAlert className='size-4' />
          <AlertTitle>We could not check the invoice</AlertTitle>
          <AlertDescription className='flex flex-col gap-2'>
            <span>{runError}</span>
            <Button variant='outline' size='sm' onClick={onRefresh}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {failed && (
        <div className='flex flex-wrap gap-2'>
          <Button variant='outline' size='sm' onClick={onRetry}>
            Try again
          </Button>
          {onOpenBill && (
            <Button variant='outline' size='sm' onClick={onOpenBill}>
              Open that bill
            </Button>
          )}
        </div>
      )}
      {!failed && !needsVendor && (
        <p className='text-muted-foreground text-xs'>
          You can close this; the bill will appear in the list when it is ready.
        </p>
      )}
    </div>
  )
}

function PhaseRow({
  phase,
  current,
  done,
  failed,
}: {
  phase: BillIntakePhase
  current: BillIntakePhase | null
  done: boolean
  failed: boolean
}) {
  const index = BILL_INTAKE_PHASES.indexOf(phase)
  const currentIndex = current ? BILL_INTAKE_PHASES.indexOf(current) : -1
  const isDone = done || index < currentIndex
  const isActive = !done && index === currentIndex
  return (
    <li className='flex items-center gap-2.5 text-sm'>
      <span className='flex size-5 items-center justify-center'>
        {isDone ? (
          <Check className='size-4 text-green-600' />
        ) : isActive && !failed ? (
          <Loader2 className='size-4 animate-spin text-muted-foreground' />
        ) : (
          <span className='size-1.5 rounded-full bg-muted-foreground/40' />
        )}
      </span>
      <span className={isDone || isActive ? '' : 'text-muted-foreground'}>
        {BILL_INTAKE_PHASE_LABELS[phase]}
      </span>
    </li>
  )
}

const PAGE_TITLES: Record<Page, string> = {
  choose: 'Choose',
  manual: 'Enter by hand',
  upload: 'Upload',
  reading: 'Reading',
}
