// apps/web/src/components/purchasing/vendor-bill/vendor-bill-document-tab.tsx
'use client'

import type { TranscribedInvoice } from '@auxx/lib/accounting/purchasing/bill-intake/client'
import type { FileValue } from '@auxx/lib/field-values/client'
import { getDefinitionId, type RecordId } from '@auxx/types/resource'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import Papa from 'papaparse'
import { useMemo, useState } from 'react'
import { parseFileOptions } from '~/components/custom-fields/ui/file-options-editor'
import type { DetailViewTabProps } from '~/components/detail-view'
import { useFieldFileUpload } from '~/components/fields/inputs/hooks/use-field-file-upload'
import { FileSelectDropZone } from '~/components/file-select/file-select-drop-zone'
import { RecordDocumentPane } from '~/components/records/record-document-pane'
import { useRecordDrawerReadOnly } from '~/components/records/use-record-drawer-read-only'
import { parseRecordId } from '~/components/resources'
import { useFileRefs } from '~/components/resources/hooks/use-file-refs'
import { useResourceFields } from '~/components/resources/hooks/use-resource-fields'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import { BillReadBanner } from './bill-read-banner'

const DOCUMENT_ATTRIBUTES = ['vendor_bill_document', 'vendor_bill_attachments'] as const

/** Source invoice and transcription within the shared full-screen record view. */
export function VendorBillDocumentTab({ recordId }: DetailViewTabProps) {
  const [view, setView] = useState<'document' | 'read'>('document')
  const { values } = useSystemValues(recordId, DOCUMENT_ATTRIBUTES, { autoFetch: true })
  const { data: intakeRun } = api.purchasing.getBillIntakeRunForBill.useQuery(
    { billRecordId: recordId },
    { staleTime: 60_000 }
  )
  const documentValue = (values.vendor_bill_document as FileValue[] | undefined)?.[0]
  const attachmentValue = (values.vendor_bill_attachments as FileValue[] | undefined)?.[0]
  const documentRef = (documentValue ?? attachmentValue)?.ref ?? null
  const documentRefs = useMemo(() => (documentRef ? [documentRef] : []), [documentRef])
  const { detailsByRef } = useFileRefs(documentRefs)
  const documentDetail = documentRef ? detailsByRef.get(documentRef) : undefined
  const readOnly = useRecordDrawerReadOnly(
    getDefinitionId(recordId),
    parseRecordId(recordId).entityInstanceId
  )

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      {intakeRun && (
        <div className='flex min-w-0 shrink-0 items-center justify-between gap-3 border-b px-3 py-2'>
          <span
            className='min-w-0 truncate text-xs text-muted-foreground'
            title={documentDetail?.name ?? intakeRun.fileName ?? undefined}>
            {documentDetail?.name ?? intakeRun.fileName ?? 'Invoice'}
          </span>
          <RadioTab
            value={view}
            onValueChange={(value) => setView(value as 'document' | 'read')}
            size='sm'
            className='shrink-0'>
            <RadioTabItem value='document' size='sm'>
              Original
            </RadioTabItem>
            <RadioTabItem value='read' size='sm'>
              As read
            </RadioTabItem>
          </RadioTab>
        </div>
      )}
      <div className='min-w-0 shrink-0'>
        <BillReadBanner billRecordId={recordId} />
      </div>
      <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
        <RecordDocumentPane
          view={view}
          className='rounded-none border-0 shadow-none'
          documentRef={documentRef}
          fileName={documentDetail?.name ?? null}
          mimeType={documentDetail?.mimeType ?? null}
          extractedText={intakeRun?.extractedText ?? null}
          asReadText={
            intakeRun ? formatInvoiceRead(intakeRun.transcription, intakeRun.extractedText) : null
          }
          emptyState={
            <VendorBillDocumentUpload
              recordId={recordId}
              entityDefinitionId={getDefinitionId(recordId)}
              readOnly={readOnly}
            />
          }
        />
      </div>
    </div>
  )
}

function formatInvoiceRead(
  transcription: TranscribedInvoice | null | undefined,
  extractedText: string | null
): string | null {
  if (!transcription) return extractedText
  const header = [
    ['Vendor', transcription.vendorName ?? ''],
    ['Vendor email', transcription.vendorEmail ?? ''],
    ['Vendor address', transcription.vendorAddress ?? ''],
    ['Invoice number', transcription.invoiceNumber ?? ''],
    ['Invoice date', transcription.invoiceDate ?? ''],
    ['Due date', transcription.dueDate ?? ''],
    ['Payment terms', transcription.paymentTerms ?? ''],
    ['Purchase order', transcription.purchaseOrderReference ?? ''],
    ['Currency', transcription.currency ?? ''],
    ['Subtotal', transcription.subtotalText ?? ''],
    ['Shipping', transcription.shippingText ?? ''],
    ['Tax', transcription.taxText ?? ''],
    ['Total', transcription.totalText ?? ''],
  ]
  const lines = transcription.lines.map((line, index) => [
    line.lineNumber ?? index + 1,
    line.vendorCode ?? '',
    line.customerCode ?? '',
    line.description ?? '',
    line.quantity ?? '',
    line.unitPriceText ?? '',
    line.lineTotalText ?? '',
  ])
  return [
    '# Invoice',
    Papa.unparse(header),
    '# Lines',
    Papa.unparse([
      [
        'Line',
        'Vendor code',
        'Customer code',
        'Description',
        'Quantity',
        'Unit price',
        'Line total',
      ],
      ...lines,
    ]),
  ].join('\n')
}

function VendorBillDocumentUpload({
  recordId,
  entityDefinitionId,
  readOnly,
}: {
  recordId: RecordId
  entityDefinitionId: string
  readOnly: boolean
}) {
  const { fields } = useResourceFields(entityDefinitionId)
  const field = fields.find((candidate) => candidate.systemAttribute === 'vendor_bill_document')
  const uploader = useFieldFileUpload({
    recordId,
    fieldRef: field?.id ?? '',
    fileOptions: parseFileOptions(field?.options),
  })
  const [dragActive, setDragActive] = useState(false)
  const disabled = readOnly || !field || uploader.isUploading

  if (!field) {
    return (
      <div className='flex h-full items-center justify-center p-6 text-sm text-muted-foreground'>
        Document upload is unavailable.
      </div>
    )
  }

  return (
    <FileSelectDropZone
      onFilesSelected={(files) => void uploader.uploadFiles(files)}
      onBrowseExisting={uploader.openNativeFilePicker}
      dragActive={dragActive}
      onDragActiveChange={setDragActive}
      maxFiles={1}
      disabled={disabled}
      showFilePicker={false}
      fileExtensions={['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic']}
      accept='image/*,.heic,.pdf'
      placeholder={
        uploader.isUploading ? 'Uploading invoice…' : 'Drop an invoice here or click to upload'
      }
      className='min-h-56 p-6'
    />
  )
}
