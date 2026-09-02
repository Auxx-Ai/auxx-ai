// apps/web/src/components/purchasing/intake/ui/quote-intake-dialog.tsx
'use client'

// Upload a vendor quote and start the read (plans/money/tasks/38 §6.2).
//
// Three pages, `crawl-website-wizard.tsx`'s shape:
//
//   gate     the model cannot read files -> this is the ONLY page
//   upload   drop zone, then a compact file card
//   reading  the job's phases ticking, then a push to the review route
//
// 🛑 The dialog CANNOT hold the review. `DialogNavPages` springs to a per-page
// `DialogSize` whose largest token is `3xl` = 56rem; one review row needs ~52rem
// before the source document gets a pixel. The review is a route, at
// `/app/purchase-orders/intake/[draftId]`.
//
// 🛑 The capability check runs ON OPEN, not after the upload. Refusing a person
// after they picked a file is the bad version of the same refusal.

import {
  INTAKE_PHASE_LABELS,
  INTAKE_PHASES,
  type IntakeDraftPhase,
} from '@auxx/lib/purchasing/intake/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { formatBytes } from '@auxx/utils/file'
import { Check, FileText, Loader2, Trash2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileSelectDropZone } from '~/components/file-select/file-select-drop-zone'
import { useResourceFields } from '~/components/resources'
import { api } from '~/trpc/react'
import { addIntakePointer } from '../hooks/use-intake-pointer'
import { useQuoteUpload } from '../hooks/use-quote-upload'

type Page = 'gate' | 'upload' | 'reading'

/**
 * What the drop zone will take. Narrower than `purchase_order.attachments`
 * allows, because these are the formats the transcriber can actually read: PDFs
 * and images go straight to the model, spreadsheets are converted server-side
 * first (§3.2). A `.zip` accepted here would fail 40 seconds later.
 */
const QUOTE_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
  '.csv',
  '.xlsx',
  '.xls',
  '.txt',
  '.eml',
]

interface QuoteIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuoteIntakeDialog({ open, onOpenChange }: QuoteIntakeDialogProps) {
  const router = useRouter()
  const [page, setPage] = useState<Page>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)

  const { fields } = useResourceFields('purchase_order')
  const attachmentsFieldId = useMemo(
    () => fields.find((f) => f.systemAttribute === 'purchase_order_attachments')?.id ?? '',
    [fields]
  )

  const { upload, isUploading } = useQuoteUpload({ fieldRef: attachmentsFieldId })
  const startIntake = api.purchasing.startQuoteIntake.useMutation()

  // Runs on open, before a file is chosen. `enabled` is the whole gate.
  const capability = api.purchasing.intakeModelCapability.useQuery(undefined, { enabled: open })

  // Poll only while the draft is still being read; the phase list ticks off this.
  const draft = api.purchasing.getIntakeDraft.useQuery(
    { draftId: draftId ?? '' },
    {
      enabled: Boolean(draftId) && page === 'reading',
      refetchInterval: (query) => (query.state.data?.status === 'reading' ? 1500 : false),
    }
  )

  // A fresh dialog every open — a stale page or a stale file carried into a
  // second open is how somebody uploads last week's quote by accident.
  useEffect(() => {
    if (!open) return
    setPage('upload')
    setFile(null)
    setDraftId(null)
  }, [open])

  // The refusal is a PAGE, not a toast: it names the model and links to where the
  // model is changed, and there is nothing else to do in this dialog until it is.
  useEffect(() => {
    if (capability.data && !capability.data.ok) setPage('gate')
  }, [capability.data])

  const draftStatus = draft.data?.status
  const draftError = draft.data?.error

  useEffect(() => {
    if (!draftId || page !== 'reading') return
    if (draftStatus === 'ready') {
      router.push(`/app/purchase-orders/intake/${draftId}`)
      onOpenChange(false)
    }
  }, [draftId, draftStatus, page, router, onOpenChange])

  const handleFilesSelected = useCallback((files: File[]) => {
    const next = files[0]
    if (!next) return
    setFile(next)
  }, [])

  const handleStart = useCallback(async () => {
    if (!file) return
    try {
      const uploaded = await upload(file)
      const started = await startIntake.mutateAsync({
        assetRef: uploaded.assetRef,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType ?? undefined,
      })
      addIntakePointer({
        draftId: started.draftId,
        vendorLabel: null,
        startedAt: new Date().toISOString(),
      })
      setDraftId(started.draftId)
      setPage('reading')
    } catch (error) {
      toastError({
        title: 'Could not read the quote',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [file, upload, startIntake])

  const isStarting = isUploading || startIntake.isPending
  const currentPhase = draft.data?.phase ?? null
  const failed = draftStatus === 'failed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title='Read a vendor quote'
            description='Upload the quote and it comes back as a drafted purchase order with its lines matched to your parts. Nothing is written until you confirm.'
            crumbs={[{ label: PAGE_TITLES[page], icon: <FileText /> }]}
          />

          <DialogNavPages value={page}>
            <DialogNavPage value='gate' size='sm'>
              <div className='p-3'>
                <Alert variant='destructive'>
                  <TriangleAlert className='size-4' />
                  <AlertTitle>This model cannot read documents</AlertTitle>
                  <AlertDescription className='flex flex-col gap-2'>
                    <span>
                      {capability.data?.reason ??
                        'Reading a quote needs a model that accepts file or image input.'}
                    </span>
                    {capability.data?.modelId && (
                      <span className='text-xs'>
                        Current model:{' '}
                        <span className='font-medium'>{capability.data.modelId}</span>
                      </span>
                    )}
                    <Link href='/app/settings/aiModels' className='text-xs underline'>
                      Change the default model
                    </Link>
                  </AlertDescription>
                </Alert>
              </div>
            </DialogNavPage>

            <DialogNavPage value='upload' size='md'>
              <div className='flex flex-col gap-3 p-3'>
                {!file ? (
                  <FileSelectDropZone
                    onFilesSelected={handleFilesSelected}
                    onBrowseExisting={() => {}}
                    dragActive={dragActive}
                    onDragActiveChange={setDragActive}
                    maxFiles={1}
                    fileExtensions={QUOTE_EXTENSIONS}
                    placeholder='Drop the quote here or click to select'
                    showFilePicker={false}
                    className='min-h-[180px] rounded-xl border border-dashed'
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
                    <Button
                      variant='destructive-hover'
                      size='icon-sm'
                      onClick={() => setFile(null)}
                      disabled={isStarting}>
                      <Trash2 />
                    </Button>
                  </div>
                )}
                <p className='text-muted-foreground text-xs'>
                  One document per quote. PDFs, images and spreadsheets are all read; a quote that
                  arrived as "the PDF plus the mail that carried it" needs the PDF.
                </p>
              </div>
            </DialogNavPage>

            <DialogNavPage value='reading' size='md'>
              <div className='flex flex-col gap-3 p-3'>
                <ul className='flex flex-col gap-2'>
                  {INTAKE_PHASES.map((phase) => (
                    <PhaseRow
                      key={phase}
                      phase={phase}
                      current={currentPhase}
                      done={draftStatus === 'ready'}
                      failed={failed}
                    />
                  ))}
                </ul>
                {failed ? (
                  <Alert variant='destructive'>
                    <TriangleAlert className='size-4' />
                    <AlertDescription>
                      {draftError ?? 'The quote could not be read.'}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    This takes about a minute. You can close this and come back — the quote is
                    waiting on the purchase orders page when it is done.
                  </p>
                )}
              </div>
            </DialogNavPage>
          </DialogNavPages>

          <DialogFooter className='mt-0 border-t p-3'>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => onOpenChange(false)}
              disabled={isStarting}>
              {page === 'reading' ? 'Close' : 'Cancel'}{' '}
              <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {page === 'upload' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => void handleStart()}
                loading={isStarting}
                loadingText='Uploading...'
                disabled={!file || !attachmentsFieldId}
                data-dialog-submit>
                Read quote <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {page === 'reading' && draftId && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  router.push(`/app/purchase-orders/intake/${draftId}`)
                  onOpenChange(false)
                }}
                data-dialog-submit>
                Open draft <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const PAGE_TITLES: Record<Page, string> = {
  gate: 'Not available',
  upload: 'Upload',
  reading: 'Reading',
}

/**
 * One phase of the read.
 *
 * The whole list renders up front and each entry ticks as the job reports it,
 * because a 40-second spinner tells a person nothing is happening and a 40-second
 * checklist tells them where it is.
 */
function PhaseRow({
  phase,
  current,
  done,
  failed,
}: {
  phase: IntakeDraftPhase
  current: IntakeDraftPhase | null
  done: boolean
  failed: boolean
}) {
  const index = INTAKE_PHASES.indexOf(phase)
  const currentIndex = current ? INTAKE_PHASES.indexOf(current) : -1
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
        {INTAKE_PHASE_LABELS[phase]}
      </span>
    </li>
  )
}
