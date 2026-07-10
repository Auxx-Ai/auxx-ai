// apps/web/src/components/dispatch/ui/add-worker-dialog.tsx
'use client'

import { type ActorId, parseActorId, toActorId } from '@auxx/types/actor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { ActorPickerContent } from '~/components/pickers/actor-picker/actor-picker-content'
import { api } from '~/trpc/react'

interface AddWorkerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing worker userIds — excluded from the picker so a user can't be added twice. */
  excludeUserIds: string[]
  onAdded: (workerId: string) => void
}

/**
 * "Add a worker" flow — a small template/gallery-style dialog (ui-design-guide.md §6) around
 * `ActorPickerContent` (`target='user'`, single-select). Picking a member immediately upserts
 * a `DispatchWorker` row for them (07-m2-build.md §E.1).
 */
export function AddWorkerDialog({
  open,
  onOpenChange,
  excludeUserIds,
  onAdded,
}: AddWorkerDialogProps) {
  const utils = api.useUtils()
  const [selected, setSelected] = useState<ActorId[]>([])

  const upsertWorker = api.dispatch.upsertWorker.useMutation({
    onSuccess: (worker) => {
      utils.dispatch.listWorkers.invalidate()
      setSelected([])
      onOpenChange(false)
      onAdded(worker.id)
    },
    onError: (error) => toastError({ title: 'Error adding worker', description: error.message }),
  })

  const excludeIds = excludeUserIds.map((userId) => toActorId('user', userId))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSelected([])
        onOpenChange(next)
      }}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Add a worker</DialogTitle>
          <DialogDescription>
            Pick a team member to make them schedulable on the dispatch board.
          </DialogDescription>
        </DialogHeader>
        <ActorPickerContent
          value={selected}
          onChange={setSelected}
          target='user'
          multi={false}
          excludeIds={excludeIds}
          placeholder='Search members...'
          disabled={upsertWorker.isPending}
          onSelectSingle={(actorId) => {
            const { id: userId } = parseActorId(actorId)
            upsertWorker.mutate({ userId })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
