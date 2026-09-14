// apps/web/src/components/returns/intake/ui/return-intake-dialog.tsx
'use client'

// Photograph the labels on the boxes and start the read
// (plans/money/tasks/57-return-intake-wizard.md §7.2).
//
// Three pages, `quote-intake-dialog.tsx`'s shape:
//
//   gate     the model cannot read images -> this is the ONLY page
//   upload   drop zone (MULTIPLE), then one compact card per photo
//   reading  the job's phases ticking, n of m, then a push to the review route
//
// 🛑 The dialog CANNOT hold the review. `DialogNavPages` springs to a per-page
// `DialogSize` whose largest token is `3xl` = 56rem, and the review needs the
// photo beside the fields so a person can check a transcription against a
// crumpled label. The review is a route, at `/app/returns/intake/[draftId]`.
// It also gives the dock a URL a second person can open, which a dialog cannot.
//
// 🛑 The capability check runs ON OPEN, not after the upload. Refusing a person
// after they picked a file is the bad version of the same refusal.
//
// ⚠️ This is a phone or a tablet at a receiving dock. The drop zone's `accept`
// carries `image/*` as well as the extensions, because that is what makes a
// phone's file sheet offer "Take Photo" beside the photo library; an
// extension-only `accept` does not reliably do it on iOS. It is deliberately
// NOT `capture='environment'`, which would FORCE the camera and take the
// gallery away from a worker who already photographed the pallet.

import {
  RETURN_INTAKE_MAX_LABELS,
  RETURN_INTAKE_PHASE_LABELS,
  RETURN_INTAKE_PHASES,
  RETURN_LABEL_EXTENSIONS,
  type ReturnIntakeDraftPhase,
} from '@auxx/lib/returns/intake/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { formatBytes } from '@auxx/utils/file'
import { Check, Image as ImageIcon, Loader2, ScanLine, Trash2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileSelectDropZone } from '~/components/file-select/file-select-drop-zone'
import { useResourceFields } from '~/components/resources'
import { api } from '~/trpc/react'
import { type LabelUploadResult, useLabelUpload } from '../hooks/use-label-upload'

type Page = 'gate' | 'upload' | 'reading'

/**
 * What the hidden input advertises. The extension list is the contract
 * (`RETURN_LABEL_EXTENSIONS`); `image/*` is added here only so a phone offers
 * its camera. See the header note.
 */
const LABEL_ACCEPT = ['image/*', ...RETURN_LABEL_EXTENSIONS].join(',')

interface ReturnIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReturnIntakeDialog({ open, onOpenChange }: ReturnIntakeDialogProps) {
  const router = useRouter()
  const [page, setPage] = useState<Page>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)

  const { fields } = useResourceFields('returns')
  const photosFieldId = useMemo(
    () => fields.find((f) => f.systemAttribute === 'return_photos')?.id ?? '',
    [fields]
  )

  const { upload, isUploading, progress } = useLabelUpload({ fieldRef: photosFieldId })
  const startIntake = api.returnIntake.start.useMutation()

  // Runs on open, before a photo is chosen. `enabled` is the whole gate.
  const capability = api.returnIntake.checkCapability.useQuery(undefined, { enabled: open })

  // Poll only while the draft is still being read; the phase list ticks off this.
  const draft = api.returnIntake.get.useQuery(
    { draftId: draftId ?? '' },
    {
      enabled: Boolean(draftId) && page === 'reading',
      refetchInterval: (query) => (query.state.data?.status === 'reading' ? 1500 : false),
    }
  )

  // A fresh dialog every open — a stale page or a stale photo carried into a
  // second open is how somebody files last week's pallet by accident.
  useEffect(() => {
    if (!open) return
    setPage('upload')
    setFiles([])
    setDraftId(null)
  }, [open])

  // The refusal is a PAGE, not a toast: it names the model and links to where the
  // model is changed, and there is nothing else to do in this dialog until it is.
  useEffect(() => {
    if (capability.data && !capability.data.ok) setPage('gate')
  }, [capability.data])

  const draftStatus = draft.data?.status
  const failureReason = draft.data?.failureReason ?? null

  useEffect(() => {
    if (!draftId || page !== 'reading') return
    if (draftStatus === 'ready') {
      router.push(`/app/returns/intake/${draftId}`)
      onOpenChange(false)
    }
  }, [draftId, draftStatus, page, router, onOpenChange])

  // 🛑 The cap is enforced HERE. `FileSelectDropZone`'s `maxFiles` only prints
  // "Maximum N files" — it does not refuse the 21st, and its hidden input is
  // unconditionally `multiple`.
  const handleFilesSelected = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return
    setFiles((current) => {
      const room = RETURN_INTAKE_MAX_LABELS - current.length
      if (room <= 0) {
        toastError({
          title: 'That is as many labels as one upload takes',
          description: `Drop up to ${RETURN_INTAKE_MAX_LABELS} photos at a time and start a second read for the rest.`,
        })
        return current
      }
      if (incoming.length > room) {
        toastError({
          title: 'Some photos were left out',
          description: `One upload takes ${RETURN_INTAKE_MAX_LABELS} labels, so ${incoming.length - room} of these were not added.`,
        })
      }
      return [...current, ...incoming.slice(0, room)]
    })
  }, [])

  const removeFileAt = useCallback((index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index))
  }, [])

  const handleStart = useCallback(async () => {
    if (files.length === 0) return
    try {
      const uploaded = await upload(files)
      const landed = uploaded.filter(
        (u): u is LabelUploadResult & { fileRef: string } => u.fileRef !== null
      )

      // ⚠️ One bad photo must not cost the other nine. The batch starts on what
      // landed and names what did not; only an empty batch is a refusal.
      if (landed.length === 0) {
        throw new Error(uploaded[0]?.error ?? 'None of the photos could be uploaded.')
      }
      if (landed.length < uploaded.length) {
        const failed = uploaded.filter((u) => u.fileRef === null)
        toastError({
          title: `${failed.length} of ${uploaded.length} photos did not upload`,
          description: `Reading the rest. Not uploaded: ${failed.map((f) => f.fileName).join(', ')}`,
        })
      }

      const started = await startIntake.mutateAsync({
        // ⚠️ `fileRef` + `fileName` only. The MIME type is NOT sent: the asset
        // already carries its own, resolved by the upload door, and a second
        // copy taken from the browser is the one that can disagree with it.
        labels: landed.map((u) => ({ fileRef: u.fileRef, fileName: u.fileName })),
      })
      setDraftId(started.draftId)
      setPage('reading')
    } catch (error) {
      toastError({
        title: 'Could not read the labels',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [files, upload, startIntake])

  const isStarting = isUploading || startIntake.isPending
  const currentPhase = draft.data?.phase ?? null
  const failed = draftStatus === 'failed'
  const labelsRead = draft.data?.labelsRead ?? 0
  const labelsTotal = draft.data?.labelsTotal ?? files.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title='Read a return label'
            description='Photograph the labels on the boxes that turned up and they come back as drafted returns with their customers matched. Nothing is written until you confirm.'
            crumbs={[{ label: PAGE_TITLES[page], icon: <ScanLine /> }]}
          />

          <DialogNavPages value={page}>
            <DialogNavPage value='gate' size='sm'>
              <div className='p-3'>
                <Alert variant='destructive'>
                  <TriangleAlert className='size-4' />
                  <AlertTitle>This model cannot read photos</AlertTitle>
                  <AlertDescription className='flex flex-col gap-2'>
                    <span>
                      {capability.data?.reason ??
                        'Reading a return label needs a model that accepts image input.'}
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
                {files.length > 0 && (
                  <ul className='flex flex-col gap-2'>
                    {files.map((file, index) => (
                      <LabelFileCard
                        key={`${file.name}-${file.size}-${index}`}
                        file={file}
                        percent={progress[file.name] ?? null}
                        disabled={isStarting}
                        onRemove={() => removeFileAt(index)}
                      />
                    ))}
                  </ul>
                )}

                {files.length < RETURN_INTAKE_MAX_LABELS && (
                  <FileSelectDropZone
                    onFilesSelected={handleFilesSelected}
                    onBrowseExisting={() => {}}
                    dragActive={dragActive}
                    onDragActiveChange={setDragActive}
                    disabled={isStarting}
                    maxFiles={RETURN_INTAKE_MAX_LABELS}
                    fileExtensions={[...RETURN_LABEL_EXTENSIONS]}
                    accept={LABEL_ACCEPT}
                    placeholder={
                      files.length === 0
                        ? 'Photograph the labels, or drop the photos here'
                        : 'Add another label'
                    }
                    showFilePicker={false}
                    className={
                      files.length === 0
                        ? 'min-h-[180px] rounded-xl border border-dashed'
                        : 'min-h-[120px] rounded-xl border border-dashed'
                    }
                  />
                )}

                <p className='text-muted-foreground text-xs'>
                  One photo per label, up to {RETURN_INTAKE_MAX_LABELS}. Several parcels from the
                  same customer become one return; a different customer becomes a different one.
                </p>
              </div>
            </DialogNavPage>

            <DialogNavPage value='reading' size='md'>
              <div className='flex flex-col gap-3 p-3'>
                <ul className='flex flex-col gap-2'>
                  {RETURN_INTAKE_PHASES.map((phase) => (
                    <PhaseRow
                      key={phase}
                      phase={phase}
                      current={currentPhase}
                      done={draftStatus === 'ready'}
                      failed={failed}
                      labelsRead={labelsRead}
                      labelsTotal={labelsTotal}
                    />
                  ))}
                </ul>
                {failed ? (
                  <Alert variant='destructive'>
                    <TriangleAlert className='size-4' />
                    <AlertDescription>
                      {failureReason ?? 'The labels could not be read.'}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    About ten seconds a label. You can close this and come back — the draft is
                    waiting on the returns page when it is done.
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
                disabled={files.length === 0 || !photosFieldId}
                data-dialog-submit>
                {files.length > 1 ? `Read ${files.length} labels` : 'Read label'}{' '}
                <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {page === 'reading' && draftId && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  router.push(`/app/returns/intake/${draftId}`)
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

/**
 * The entry point on the returns list — `RecordsView`'s `pageActions` slot,
 * beside Create (§7.1).
 *
 * 🛑 This ADDS a door and closes none. The ticket block's create action
 * (`ticket-returns-actions.tsx`) and the generic entity create dialog both stay
 * exactly as they are: a return a customer *asked* for starts from the ticket,
 * and a return that *showed up* starts from a photograph.
 */
export function ReadReturnLabelsButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <ScanLine /> Read a label
      </Button>
      {/* Mounted only while open so the capability check (which runs ON OPEN, not
          after the upload) is not a query on every visit to the list. */}
      {open && <ReturnIntakeDialog open={open} onOpenChange={setOpen} />}
    </>
  )
}

const PAGE_TITLES: Record<Page, string> = {
  gate: 'Not available',
  upload: 'Photos',
  reading: 'Reading',
}

/** One queued photo: name, size, its own bar while uploading, and a remove. */
function LabelFileCard({
  file,
  percent,
  disabled,
  onRemove,
}: {
  file: File
  percent: number | null
  disabled: boolean
  onRemove: () => void
}) {
  return (
    <li className='flex items-center justify-between gap-3 rounded-xl border p-3'>
      <div className='flex min-w-0 items-center gap-3'>
        <ImageIcon className='size-4 shrink-0 text-muted-foreground' />
        <div className='min-w-0'>
          <p className='truncate font-medium text-sm'>{file.name}</p>
          <p className='text-muted-foreground text-xs'>
            {formatBytes(file.size)}
            {percent !== null && percent < 100 ? ` · ${Math.round(percent)}%` : ''}
          </p>
        </div>
      </div>
      <Button
        variant='destructive-hover'
        size='icon-sm'
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}>
        <Trash2 />
      </Button>
    </li>
  )
}

/**
 * One phase of the read.
 *
 * The whole list renders up front and each entry ticks as the job reports it,
 * because a 40-second spinner tells a person nothing is happening and a
 * 40-second checklist tells them where it is.
 *
 * ⚠️ `reading` is n of m, never a spinner alone: it is one model call PER LABEL
 * (§3.1), and ten photos at a dock is ten calls. "Reading label 3 of 7" is the
 * difference between a person waiting and a person wondering.
 */
function PhaseRow({
  phase,
  current,
  done,
  failed,
  labelsRead,
  labelsTotal,
}: {
  phase: ReturnIntakeDraftPhase
  current: ReturnIntakeDraftPhase | null
  done: boolean
  failed: boolean
  labelsRead: number
  labelsTotal: number
}) {
  const index = RETURN_INTAKE_PHASES.indexOf(phase)
  const currentIndex = current ? RETURN_INTAKE_PHASES.indexOf(current) : -1
  const isDone = done || index < currentIndex
  const isActive = !done && index === currentIndex

  const label =
    phase === 'reading' && isActive && labelsTotal > 0
      ? `Reading label ${Math.min(labelsRead + 1, labelsTotal)} of ${labelsTotal}`
      : RETURN_INTAKE_PHASE_LABELS[phase]

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
      <span className={isDone || isActive ? '' : 'text-muted-foreground'}>{label}</span>
    </li>
  )
}
