// apps/web/src/components/purchasing/intake/ui/intake-review-page.tsx
'use client'

// The review screen for one read quote (plans/money/tasks/38 §6.2).
//
// 🛑 A ROUTE, not a dialog. `DialogNavPages`' largest size token is 56rem and one
// review row needs ~52rem before the source document gets a pixel; the
// side-by-side layout needs ~76rem. The transcription is also a worker job, so
// its result outlives the dialog that started it — same reason
// `/app/purchase-orders/import/[jobId]` is a page.
//
// 🛑 Nothing on this screen writes an `EntityInstance`. Every edit lands in the
// draft payload (`use-intake-draft.ts`); `commitIntakeDraft` is the only write
// that mints records, and the button that calls it stays DISABLED while any line
// is still missing a part.

import { type IntakeWriteBack, unresolvedLines } from '@auxx/lib/purchasing/intake/client'
import { parseRecordId } from '@auxx/lib/resources/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@auxx/ui/components/resizable'
import { toastError } from '@auxx/ui/components/toast'
import { Clock, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { LoadingSpinner } from '~/components/global/loading-content'
import type { PartPrefillLookup } from '~/components/money/ui/line-builder/line-rows'
import { useRecord } from '~/components/resources'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useIntakeDraftEditor } from '../hooks/use-intake-draft'
import { removeIntakePointer } from '../hooks/use-intake-pointer'
import { IntakeCommitDialog } from './intake-commit-dialog'
import { IntakeDocumentPreview } from './intake-document-preview'
import { IntakeHeaderPanel } from './intake-header-panel'
import { IntakeLinesTable } from './intake-lines-table'

export function IntakeReviewPage({ draftId }: { draftId: string }) {
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()
  const [commitOpen, setCommitOpen] = useState(false)

  const draft = api.purchasing.getIntakeDraft.useQuery(
    { draftId },
    {
      // Poll only while the worker is still writing. Once it is `ready` the
      // client owns the payload and a refetch would race the person's edits.
      refetchInterval: (query) => (query.state.data?.status === 'reading' ? 1500 : false),
      // 🛑 No retries. The draft lives in Redis on a 24h TTL, so the ONLY reason
      // this read fails is that it is gone — retrying a not-found three times just
      // holds the spinner over an answer that will not change.
      retry: false,
    }
  )

  const editor = useIntakeDraftEditor(draftId, draft.data?.payload ?? null)
  const payload = editor.payload

  const discardDraft = api.purchasing.discardIntakeDraft.useMutation()
  const commitDraft = api.purchasing.commitIntakeDraft.useMutation()

  const vendorRecord = useRecord({
    recordId: payload?.vendorRecordId ?? undefined,
    enabled: Boolean(payload?.vendorRecordId),
  })
  const vendorName = vendorRecord.record?.displayName ?? payload?.transcription.vendorName ?? null

  const utils = api.useUtils()

  // ✅ The prefill passes straight through, and it is a gift: `applyPartPrefill`
  // writes the price ONLY into an empty cell, and every intake price arrives
  // filled from the quote — so the vendor's printed price always wins, while the
  // prefill still stamps `vendorPartRecordId` provenance on every part pick,
  // which is §5.3's write-back input, already wired, at no cost.
  //
  // Built exactly as `purchase-order-lines-tab.tsx` builds it, including the two
  // failure shapes: a lookup that ran and found nothing CLEARS the link (it
  // belonged to the previously picked part); a thrown lookup returns `null` and
  // changes nothing, because a network failure is not evidence of absence.
  const lookupPrefill = useCallback<PartPrefillLookup>(
    async ({ partRecordId, vendorRecordId }) => {
      try {
        const found = await utils.purchasing.vendorPartForLine.fetch({
          partInstanceId: parseRecordId(partRecordId).entityInstanceId,
          vendorInstanceId: parseRecordId(vendorRecordId).entityInstanceId,
        })
        return {
          vendorPartRecordId: found?.vendorPartRecordId ?? null,
          unitPriceCents: found?.unitPrice ?? null,
        }
      } catch {
        return null
      }
    },
    [utils]
  )

  // The document's vendor is bound here, the way `LineBuilder` binds it from
  // `LineSchema.vendorAttr` — so the lookup never runs for a draft with no vendor.
  const vendorRecordId = payload?.vendorRecordId ?? null
  const resolvePartPrefill = useMemo(
    () =>
      vendorRecordId
        ? (partRecordId: Parameters<PartPrefillLookup>[0]['partRecordId']) =>
            lookupPrefill({ partRecordId, vendorRecordId })
        : undefined,
    [vendorRecordId, lookupPrefill]
  )

  const blocking = useMemo(() => (payload ? unresolvedLines(payload.lines) : []), [payload])

  const handleDiscard = async () => {
    const confirmed = await confirm({
      title: 'Discard this quote?',
      description:
        'The read and every match on it are thrown away. The uploaded document goes with it. Nothing was written, so there is nothing to undo.',
      confirmText: 'Discard',
      cancelText: 'Keep',
      destructive: true,
    })
    if (!confirmed) return
    try {
      await discardDraft.mutateAsync({ draftId })
      removeIntakePointer(draftId)
      router.push('/app/purchase-orders')
    } catch (error) {
      toastError({
        title: 'Could not discard the draft',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleCommit = async (writeBacks: IntakeWriteBack[]) => {
    try {
      // 🛑 Flush first. The commit reads the SERVER row, so a debounced edit that
      // has not landed would be silently dropped from the order.
      await editor.flush()
      const created = await commitDraft.mutateAsync({ draftId, writeBacks })
      removeIntakePointer(draftId)
      setCommitOpen(false)
      router.push(`/app/purchase-orders/${created.purchaseOrderInstanceId}`)
    } catch (error) {
      toastError({
        title: 'Could not create the purchase order',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /** Forget the pointer on the way out — it names a draft that no longer exists. */
  const handleExpired = () => {
    removeIntakePointer(draftId)
    router.push('/app/purchase-orders')
  }

  const assetId = draft.data ? draft.data.assetRef.replace(/^asset:/, '') : ''

  return (
    <MainPage>
      <ConfirmDialog />
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {editor.isDirty && <span className='text-muted-foreground text-xs'>Saving...</span>}
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void handleDiscard()}
              disabled={draft.isError || discardDraft.isPending || commitDraft.isPending}>
              Discard
            </Button>
            {/* 🛑 A hard gate, not a warning. Every committed line must carry a
                part, so letting the commit through and having the create path
                reject it would waste the transcription and report the failure at
                the least useful moment. The count is the label. */}
            <Button
              variant='outline'
              size='sm'
              onClick={() => setCommitOpen(true)}
              disabled={
                !payload ||
                blocking.length > 0 ||
                payload.vendorRecordId === null ||
                commitDraft.isPending
              }>
              {blocking.length > 0
                ? `${blocking.length} ${blocking.length === 1 ? 'line' : 'lines'} still need a part`
                : 'Create purchase order'}
            </Button>
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Purchase orders' href='/app/purchase-orders' />
          <MainPageBreadcrumbItem title={vendorName ? `Quote - ${vendorName}` : 'Quote'} />
          {/* The vendor's OWN reference, kept beside the title rather than in it:
              it is how they will refer to this order on the phone, and it is not
              our number. */}
          {(payload?.quoteNumber || draft.data?.fileName) && (
            <MainPageBreadcrumbItem
              title={payload?.quoteNumber ?? draft.data?.fileName ?? ''}
              className='text-muted-foreground'
            />
          )}
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        {draft.isLoading ? (
          <LoadingSpinner />
        ) : draft.isError ? (
          // 🛑 An expired draft is a NOT-FOUND, not a row with an old status: the
          // draft lives in Redis on the same 24h TTL as the temp asset it
          // describes, and the two go together on purpose — a live table beside a
          // dead document pane is worse than the draft simply being gone. So this
          // is a first-class state with a way forward, never an error toast over
          // a blank page.
          <div className='p-6'>
            <Alert>
              <Clock className='size-4' />
              <AlertTitle>This quote draft has expired</AlertTitle>
              <AlertDescription className='flex flex-col items-start gap-2'>
                <span>
                  A read that nobody confirms is kept for 24 hours, along with the document it was
                  read from. Nothing was written, so there is nothing to clean up.
                </span>
                <Button variant='outline' size='sm' onClick={() => handleExpired()}>
                  Back to purchase orders
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : draft.data?.status === 'failed' ? (
          <div className='p-6'>
            <Alert variant='destructive'>
              <TriangleAlert className='size-4' />
              <AlertTitle>This quote could not be read</AlertTitle>
              <AlertDescription>
                {draft.data.error ?? 'The read failed before it produced a draft.'}
              </AlertDescription>
            </Alert>
          </div>
        ) : !payload ? (
          <LoadingSpinner />
        ) : (
          <ResizablePanelGroup direction='horizontal' className='min-h-0 flex-1'>
            {/* The vendor's own document, beside the reading of it. Authorized
                against the DRAFT, not the Files app — see `AttachmentPreview`'s
                `intakeDraft` scope. */}
            <ResizablePanel defaultSize={38} minSize={20} className='min-w-0'>
              {/* No `overflow-auto` here: `IntakeDocumentPreview` owns its own
                  scrolling (a `ScrollArea` for a converted document, the
                  renderer's own for a PDF), and nesting two scroll containers
                  gives the pane two scrollbars that fight. */}
              <div className='h-full min-h-0 p-3'>
                <IntakeDocumentPreview
                  draftId={draftId}
                  assetId={assetId}
                  fileName={draft.data?.fileName ?? null}
                  mimeType={draft.data?.mimeType ?? null}
                  extractedText={draft.data?.extractedText ?? null}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={62} minSize={40} className='min-w-0'>
              <div className='flex h-full flex-col gap-4 overflow-auto p-3'>
                <IntakeHeaderPanel payload={payload} onUpdate={editor.update} />
                <IntakeLinesTable
                  lines={payload.lines}
                  currency={payload.currency}
                  vendorName={vendorName}
                  vendorRecordId={payload.vendorRecordId}
                  resolvePartPrefill={resolvePartPrefill}
                  onPatch={editor.patchLine}
                  onChooseBreak={editor.chooseBreak}
                  onFold={editor.foldLine}
                  onUnfold={editor.unfoldLine}
                  onRemove={editor.removeLine}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </MainPageContent>

      {payload && (
        <IntakeCommitDialog
          open={commitOpen}
          onOpenChange={setCommitOpen}
          payload={payload}
          vendorName={vendorName}
          fileName={draft.data?.fileName ?? null}
          isPending={commitDraft.isPending}
          onConfirm={(writeBacks) => void handleCommit(writeBacks)}
        />
      )}
    </MainPage>
  )
}
