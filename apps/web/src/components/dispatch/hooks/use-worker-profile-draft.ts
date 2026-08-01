// apps/web/src/components/dispatch/hooks/use-worker-profile-draft.ts
'use client'

import type { SelectOptionColor } from '@auxx/lib/custom-fields/client'
import { toastError } from '@auxx/ui/components/toast'
import type { AddressStruct } from '~/components/fields/inputs/address-struct-input-field'
import { useDirtyDraft } from '~/components/global/forms/use-dirty-draft'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import type { DispatchWorkerRow } from '../ui/worker-card'

const EMPTY_ADDRESS: AddressStruct = {
  street1: '',
  street2: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
}

/** `DispatchWorkerRow['homeBase']` types `street2` optional; the UI's `AddressStruct` doesn't. */
function normalizeAddress(value: DispatchWorkerRow['homeBase']): AddressStruct {
  if (!value) return EMPTY_ADDRESS
  return { ...value, street2: value.street2 ?? '' }
}

export interface WorkerProfileDraft {
  color: SelectOptionColor
  homeBase: AddressStruct
  isActive: boolean
  routeStartAtHome: boolean
  routeEndAtHome: boolean
}

export type WorkerProfileDraftApi = ReturnType<typeof useWorkerProfileDraft>

/**
 * Draft + mutations for the worker Profile page (07-m2-build.md §E.1), hoisted to the dialog
 * level: `DialogNavPages` unmounts inactive pages, so page-owned drafts would silently drop
 * edits on a tab switch and unmounted `useMutation` callbacks would skip their invalidation.
 * Save fans out to `upsertWorker` (color + home base + route flags) and `setWorkerActive`
 * (only when the toggle changed). `remove` confirms, then deletes the board column.
 *
 * `worker` is null during the dialog's create mode (member-select page) — the draft idles on
 * defaults and adopts the row by value once it exists; save/remove are no-ops until then.
 */
export function useWorkerProfileDraft(worker: DispatchWorkerRow | null, onRemoved: () => void) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const invalidate = () => utils.dispatch.listWorkers.invalidate()

  const upsertWorker = api.dispatch.upsertWorker.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error saving worker', description: error.message }),
  })

  const setWorkerActive = api.dispatch.setWorkerActive.useMutation({
    onSuccess: invalidate,
    onError: (error) => toastError({ title: 'Error updating worker', description: error.message }),
  })

  const removeWorker = api.dispatch.removeWorker.useMutation({
    onSuccess: () => {
      invalidate()
      onRemoved()
    },
    onError: (error) => toastError({ title: 'Error removing worker', description: error.message }),
  })

  const isSaving = upsertWorker.isPending || setWorkerActive.isPending

  // Rebuilt each render from the worker prop; `useDirtyDraft` reseeds by value, so a background
  // `listWorkers` refetch never clobbers edits.
  const server: WorkerProfileDraft = {
    color: (worker?.color as SelectOptionColor) ?? 'gray',
    homeBase: normalizeAddress(worker?.homeBase ?? null),
    isActive: worker?.isActive ?? true,
    routeStartAtHome: worker?.routeStartAtHome ?? false,
    routeEndAtHome: worker?.routeEndAtHome ?? false,
  }

  const { draft, patch, dirty, save } = useDirtyDraft(server, {
    isSaving,
    onSave: (next) => {
      if (!worker) return
      const addressChanged = JSON.stringify(next.homeBase) !== JSON.stringify(server.homeBase)
      const routeFlagsChanged =
        next.routeStartAtHome !== server.routeStartAtHome ||
        next.routeEndAtHome !== server.routeEndAtHome
      // `upsertWorker` is keyed on the User (individuals only); team rows have no `userId` and
      // are edited through the team dialog, so their profile fields never route through here.
      if (worker.userId && (next.color !== server.color || addressChanged || routeFlagsChanged)) {
        upsertWorker.mutate({
          userId: worker.userId,
          color: next.color,
          homeBase: next.homeBase,
          routeStartAtHome: next.routeStartAtHome,
          routeEndAtHome: next.routeEndAtHome,
        })
      }
      if (next.isActive !== server.isActive) {
        setWorkerActive.mutate({ workerId: worker.id, isActive: next.isActive })
      }
    },
  })

  async function remove() {
    if (!worker) return
    const confirmed = await confirm({
      title: 'Remove worker?',
      description: `This removes "${worker.user?.name ?? 'this worker'}" from the dispatch board. Their assigned visits keep their assignee — only the board column disappears.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeWorker.mutate({ workerId: worker.id })
  }

  return {
    draft,
    patch,
    dirty,
    isSaving,
    save,
    remove,
    isRemoving: removeWorker.isPending,
    ConfirmDialog,
  }
}
