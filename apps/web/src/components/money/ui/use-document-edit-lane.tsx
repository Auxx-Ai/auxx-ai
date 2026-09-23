// apps/web/src/components/money/ui/use-document-edit-lane.tsx
'use client'

import type { EditStamp, RecordId } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { useRecordEditState } from '~/components/resources/hooks'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

/** The lane families with no ledger of their own (66 U5/U7). */
export type PlainEditFamily = 'quote' | 'purchase_order' | 'order'

/**
 * Edit, Save and Cancel for a quote, purchase order or order. The mutations
 * return the stamp, so the store is patched without waiting on the realtime echo.
 */
export function useDocumentEditLane(recordId: string, family: PlainEditFamily, noun: string) {
  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const updateRecord = useRecordStore((state) => state.updateRecord)
  const { editing } = useRecordEditState(recordId as RecordId)

  const [defId, instanceId] = recordId.split(':')
  const target = { family, recordId: instanceId ?? '' }
  const stampEdit = (edit: EditStamp | null) => {
    if (defId && instanceId) updateRecord(defId, instanceId, { edit })
  }

  const open = api.documentEdit.open.useMutation({
    onSuccess: (edit) => stampEdit(edit),
    onError: (error) => toastError({ title: `Error opening ${noun}`, description: error.message }),
  })
  const save = api.documentEdit.save.useMutation({
    onSuccess: (result) => stampEdit(result.edit),
    onError: (error) => toastError({ title: `Error saving ${noun}`, description: error.message }),
  })
  const cancel = api.documentEdit.cancel.useMutation({
    onSuccess: (result) => {
      stampEdit(result.edit)
      // Restore rewrote header values and deleted the lines the edit added.
      utils.record.invalidate().catch(() => {})
    },
    onError: (error) => toastError({ title: 'Error cancelling edit', description: error.message }),
  })

  const cancelEdit = async () => {
    const confirmed = await confirm({
      title: 'Discard these changes?',
      description: `The ${noun} returns to the values it had when Edit was pressed. Lines added since are deleted.`,
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) cancel.mutate(target)
  }

  return {
    editing,
    openEdit: () => open.mutate(target),
    saveEdit: () => save.mutate(target),
    cancelEdit,
    isSaving: save.isPending,
    ConfirmDialog,
  }
}
