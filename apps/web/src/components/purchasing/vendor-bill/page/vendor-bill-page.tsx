// apps/web/src/components/purchasing/vendor-bill/page/vendor-bill-page.tsx
'use client'

// The vendor bill's own page (plans/money/tasks/58 §6): document left, cards
// right, `ModelTypeMeta.vendor_bill.hasDetailPage` now `true` (§6.1). NOT a
// `DetailView` — the document pane is the whole point of the split, and a bill
// is not built/iterated the way a purchase order is.
//
// This wave builds the shell only: no read banner, no link card (a later wave
// adds both — see `VendorBillPagePanel`'s `banner` slot, left empty here) and
// the document pane only ATTACHES, it never reads (§6.4's drop zone is a later
// wave too; today's pane just previews whatever `vendor_bill_document` /
// `vendor_bill_attachments` already hold).

import type { FileValue } from '@auxx/lib/field-values/client'
import { getDefinitionId, type RecordId, toRecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@auxx/ui/components/resizable'
import { Banknote, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DetailViewNotFound } from '~/components/detail-view'
import { LoadingSpinner } from '~/components/global/loading-content'
import { NoAccess } from '~/components/permissions/ui/no-access'
import { RecordNavButtons, useRecordNavContext } from '~/components/records/nav'
import { RecordActionsMenu } from '~/components/records/record-actions-menu'
import { RecordDocumentPane } from '~/components/records/record-document-pane'
import { parseRecordId, useRecord, useResourceProperty } from '~/components/resources'
import { useSystemField } from '~/components/resources/hooks/use-field'
import { useFileRefs } from '~/components/resources/hooks/use-file-refs'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useMedia } from '~/hooks/use-media'
import { useAccess } from '~/providers/capabilities-provider'
import { numberValue, unwrapValue } from '../../purchasing-summary-strip'
import { MarkBillPaidDialog } from '../mark-bill-paid-dialog'
import { VendorBillPagePanel } from './vendor-bill-page-panel'

const BILL_ATTRS = [
  'vendor_bill_number',
  'vendor_bill_status',
  'vendor_bill_total',
  'vendor_bill_amount_paid',
  'vendor_bill_currency',
  'vendor_bill_document',
  'vendor_bill_attachments',
] as const

export function VendorBillPage({ vendorBillId }: { vendorBillId: string }) {
  const entityDefinitionId = useResourceProperty('vendor_bill', 'id')
  const { hasDefPresence } = useAccess()

  if (!entityDefinitionId) {
    return <LoadingSpinner />
  }

  // Presence, not def-view (the same gate `detail-view.tsx` uses): a shared
  // record must be openable on its own page, and the record READ is still
  // scoped server-side (`useRecord` returns not-found for a row this member
  // cannot see).
  if (!hasDefPresence(entityDefinitionId)) {
    return <NoAccess area='Vendor Bills' backHref='/app/vendor-bills' />
  }

  const recordId = toRecordId(entityDefinitionId, vendorBillId)
  return <VendorBillPageContent recordId={recordId} />
}

function VendorBillPageContent({ recordId }: { recordId: RecordId }) {
  const { record, isLoading, isNotFound, hasLoadedOnce } = useRecord({ recordId })
  const navContext = useRecordNavContext(recordId)
  const isDesktop = useMedia('(min-width: 1024px)')
  const [showDocument, setShowDocument] = useState(false)
  const [payOpen, setPayOpen] = useState(false)

  const { values } = useSystemValues(recordId, BILL_ATTRS, { autoFetch: true })
  const statusField = useSystemField('vendor_bill_status', getDefinitionId(recordId))

  const billNumber = unwrapValue(values.vendor_bill_number) as string | null | undefined
  const status = unwrapValue(values.vendor_bill_status) as string | undefined
  const statusOption = statusField?.options?.options?.find((option) => option.value === status)
  const total = numberValue(values.vendor_bill_total)
  const amountPaid = numberValue(values.vendor_bill_amount_paid)
  const balance = total - amountPaid
  const currencyCode = (unwrapValue(values.vendor_bill_currency) as string | null) ?? 'USD'
  // Same gate `purchase-order-bills-card.tsx`'s `BillRow` applies: a void bill
  // owes nothing by definition, and a zero-total bill has no amount to settle.
  const canPay = status !== 'void' && total > 0 && balance > 0

  const documentValue = (values.vendor_bill_document as FileValue[] | undefined)?.[0]
  const attachmentValue = (values.vendor_bill_attachments as FileValue[] | undefined)?.[0]
  const fileValue = documentValue ?? attachmentValue
  const documentRef = fileValue?.ref ?? null
  const documentRefs = useMemo(() => (documentRef ? [documentRef] : []), [documentRef])
  const { detailsByRef } = useFileRefs(documentRefs)
  const documentDetail = documentRef ? detailsByRef.get(documentRef) : undefined

  if (isLoading || (!record && !hasLoadedOnce)) {
    return <LoadingSpinner />
  }

  if (isNotFound || !record) {
    const parsed = parseRecordId(recordId)
    return (
      <DetailViewNotFound
        label='Vendor Bills'
        backUrl='/app/vendor-bills'
        entityDefinitionId={parsed.entityDefinitionId}
        entityInstanceId={parsed.entityInstanceId}
      />
    )
  }

  const displayName = (record.displayName as string) || 'Untitled bill'

  const documentPane = (
    <RecordDocumentPane
      documentRef={documentRef}
      fileName={documentDetail?.name ?? null}
      mimeType={documentDetail?.mimeType ?? null}
      extractedText={null}
    />
  )

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {navContext && <RecordNavButtons context={navContext} />}
            {status && (
              <Badge variant={(statusOption?.color as Variant) ?? 'secondary'}>
                {statusOption?.label ?? status}
              </Badge>
            )}
            {canPay && (
              <Button variant='outline' size='sm' onClick={() => setPayOpen(true)}>
                <Banknote />
                Mark paid
              </Button>
            )}
            <RecordActionsMenu
              recordId={recordId}
              entityType='vendor_bill'
              record={record}
              surface='page'
            />
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Vendor bills' href='/app/vendor-bills' />
          <MainPageBreadcrumbItem title={displayName} />
          {billNumber && (
            <MainPageBreadcrumbItem title={billNumber} className='text-muted-foreground' />
          )}
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        {isDesktop ? (
          <ResizablePanelGroup direction='horizontal' className='min-h-0 flex-1'>
            {/* No `overflow-auto` here: `RecordDocumentPane` owns its own
                scrolling, and nesting two scroll containers gives the pane two
                scrollbars that fight (`intake-review-page.tsx:258-261`). */}
            <ResizablePanel defaultSize={38} minSize={20} className='min-w-0'>
              <div className='h-full min-h-0 p-3'>{documentPane}</div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={62} minSize={40} className='min-w-0'>
              <VendorBillPagePanel vendorBillRecordId={recordId} />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className='flex h-full min-h-0 flex-col'>
            <div className='flex shrink-0 items-center justify-between border-b px-3 py-1.5'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setShowDocument((current) => !current)}>
                <FileText />
                {showDocument ? 'Hide document' : 'Show document'}
              </Button>
            </div>
            {showDocument && <div className='h-72 shrink-0 border-b p-3'>{documentPane}</div>}
            <div className='min-h-0 flex-1'>
              <VendorBillPagePanel vendorBillRecordId={recordId} />
            </div>
          </div>
        )}
      </MainPageContent>

      {payOpen && (
        <MarkBillPaidDialog
          open
          onOpenChange={setPayOpen}
          billRecordId={recordId}
          total={total}
          amountPaid={amountPaid}
          currencyCode={currencyCode}
        />
      )}
    </MainPage>
  )
}
