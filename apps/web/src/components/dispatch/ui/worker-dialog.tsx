// apps/web/src/components/dispatch/ui/worker-dialog.tsx
'use client'

import { weekStartToIndex } from '@auxx/lib/availability/client'
import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ExceptionListEditor } from '~/components/availability/ui/exception-list-editor'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { useSettings } from '~/hooks/use-settings'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { useWorkerHoursDraft } from '../hooks/use-worker-hours-draft'
import { useWorkerProfileDraft } from '../hooks/use-worker-profile-draft'
import { WorkerHoursPage } from './worker-hours-page'
import { WorkerProfilePage } from './worker-profile-page'

/** The edit-mode tabs — what `initialPage` may target. */
export type WorkerDialogEditPage = 'profile' | 'time-off' | 'hours'

type WorkerDialogPage = 'member' | WorkerDialogEditPage

interface WorkerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Worker to edit; null opens in create mode — a member-select first page (07-m2-build.md §E.1). */
  workerId: string | null
  /** Tab to open on in edit mode (default 'profile'). Ignored in create mode. */
  initialPage?: WorkerDialogEditPage
}

/** A catalog SINGLE_SELECT value read via `getSetting` is a scalar, but normalize defensively. */
function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

/**
 * Workers dialog (04-ui.md §9 / 07-m2-build.md §E.1): three sibling `DialogNav` pages —
 * Profile, Time off, Hours — switched via the crumb trail acting as tabs (`active` on the
 * current crumb, per `dialog-nav.tsx`'s bidirectional-crumbs mode). With `workerId` null the
 * dialog opens in create mode: a one-way member-select page that upserts the `DispatchWorker`
 * row on pick and then springs into the regular tabs for the new row. The dialog resolves the
 * row from the cached `listWorkers` query itself, so it stays fresh across invalidations and
 * callers only hold an id. The closed shell renders null, so each open mounts fresh and the
 * drafts reset for free.
 */
export function WorkerDialog({ open, onOpenChange, workerId, initialPage }: WorkerDialogProps) {
  if (!open) return null
  return (
    <WorkerDialogContent
      open={open}
      onOpenChange={onOpenChange}
      workerId={workerId}
      initialPage={initialPage}
    />
  )
}

/**
 * The page drafts (`useWorkerProfileDraft` / `useWorkerHoursDraft`) live here, not in the
 * pages: `DialogNavPages` unmounts inactive pages, so page-owned drafts would silently drop
 * edits on a tab switch and unmounted `useMutation` callbacks would skip their invalidation.
 * The pages just render fields; the shared footer below the pages drives the active page's
 * save (Member and Time off only get Close — the picker creates on pick, Time off persists
 * per edit).
 */
function WorkerDialogContent({ open, onOpenChange, workerId, initialPage }: WorkerDialogProps) {
  const utils = api.useUtils()
  const { getSetting } = useSettings({ scope: 'GENERAL' })

  const { data: workers } = api.dispatch.listWorkers.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })
  const [createdWorkerId, setCreatedWorkerId] = useState<string | null>(null)
  const effectiveWorkerId = workerId ?? createdWorkerId
  const worker = (effectiveWorkerId && workers?.find((w) => w.id === effectiveWorkerId)) || null

  const [page, setPage] = useState<WorkerDialogPage>(
    workerId ? (initialPage ?? 'profile') : 'member'
  )
  const [selected, setSelected] = useState<ActorId[]>([])

  const addWorker = api.dispatch.upsertWorker.useMutation({
    onSuccess: (created) => {
      utils.dispatch.listWorkers.invalidate()
      setCreatedWorkerId(created.id)
    },
    onError: (error) => toastError({ title: 'Error adding worker', description: error.message }),
  })

  // Create flow: advance off the member page once the created row lands in the refetched list.
  useEffect(() => {
    if (worker && page === 'member') setPage('profile')
  }, [worker, page])

  const profile = useWorkerProfileDraft(worker, () => onOpenChange(false))
  const hours = useWorkerHoursDraft(worker?.userId ?? null)

  // Closing (Esc, outside click, Cancel) goes through the guard so unsaved edits on either
  // draft always get a discard confirmation.
  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty: profile.dirty || hours.dirty,
    onConfirmedClose: () => onOpenChange(false),
  })

  const weekStart = (scalarSetting(getSetting('organization.weekStart')) ?? 'monday') as
    | 'monday'
    | 'sunday'
    | 'saturday'
  const weekStartsOn = weekStartToIndex(weekStart)
  const use24HourTime = Boolean(scalarSetting(getSetting('organization.use24HourTime')))

  const name = worker ? worker.user?.name || worker.user?.email || 'Worker' : null

  // Footer wiring for the active page; null → no Save button (Member creates on pick,
  // Time off saves per edit).
  const footer =
    page === 'profile' ? { ...profile, saveDisabled: false } : page === 'hours' ? hours : null

  const ProfileConfirmDialog = profile.ConfirmDialog
  const HoursConfirmDialog = hours.ConfirmDialog

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size='content' position='tc' innerClassName='p-0' {...guardProps}>
          <div className='flex flex-col'>
            <DialogNav
              title={name ?? 'Add a worker'}
              description='Manage this dispatch worker.'
              heading={name ?? undefined}
              crumbs={
                worker
                  ? [
                      {
                        label: 'Profile',
                        active: page === 'profile',
                        onClick: () => setPage('profile'),
                      },
                      {
                        label: 'Time off',
                        active: page === 'time-off',
                        onClick: () => setPage('time-off'),
                      },
                      { label: 'Hours', active: page === 'hours', onClick: () => setPage('hours') },
                    ]
                  : [{ label: 'Add a worker' }]
              }
            />

            <DialogNavPages value={page}>
              {/* Kept mounted until the created row lands so the page doesn't blank out
                  during the one render where `worker` exists but `page` hasn't flipped yet. */}
              {(!worker || page === 'member') && (
                <DialogNavPage value='member' size='sm'>
                  <div className='flex flex-col gap-3 p-4'>
                    <p className='text-muted-foreground text-sm'>
                      Pick a team member to make them schedulable on the dispatch board.
                    </p>
                    <ActorPickerContent
                      value={selected}
                      onChange={setSelected}
                      className='rounded-2xl border'
                      target='user'
                      multi={false}
                      excludeIds={(workers ?? []).map((w) => toActorId('user', w.userId))}
                      placeholder='Search members...'
                      disabled={addWorker.isPending || createdWorkerId != null}
                      onSelectSingle={(actorId) => {
                        const { id: userId } = parseActorId(actorId)
                        addWorker.mutate({ userId })
                      }}
                    />
                  </div>
                </DialogNavPage>
              )}

              {worker && (
                <DialogNavPage value='profile' size='md'>
                  <WorkerProfilePage profile={profile} />
                </DialogNavPage>
              )}

              {worker && (
                <DialogNavPage value='time-off' size='md'>
                  <ExceptionListEditor
                    subject={{ type: 'worker', userId: worker.userId }}
                    use24HourTime={use24HourTime}
                    // The Section's own border-b would double up against the footer's border-t.
                    className='[&_[data-slot=section]]:border-b-0'
                  />
                </DialogNavPage>
              )}

              {worker && (
                <DialogNavPage value='hours' size='md'>
                  <WorkerHoursPage
                    hours={hours}
                    weekStartsOn={weekStartsOn}
                    use24HourTime={use24HourTime}
                  />
                </DialogNavPage>
              )}
            </DialogNavPages>

            <DialogFooter className='border-t px-4 py-2 sm:justify-between'>
              <div>
                {page === 'profile' && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    loading={profile.isRemoving}
                    onClick={profile.remove}
                    className='text-destructive hover:text-destructive'>
                    <Trash2 /> Remove worker
                  </Button>
                )}
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={guardedClose}
                  disabled={footer?.isSaving}>
                  {footer ? 'Cancel' : 'Close'} <Kbd shortcut='esc' variant='ghost' size='sm' />
                </Button>
                {footer && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={footer.save}
                    loading={footer.isSaving}
                    loadingText='Saving...'
                    disabled={!footer.dirty || footer.saveDisabled}
                    data-dialog-submit>
                    Save <KbdSubmit variant='outline' size='sm' />
                  </Button>
                )}
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ProfileConfirmDialog />
      <HoursConfirmDialog />
      <ConfirmDialog />
    </>
  )
}
