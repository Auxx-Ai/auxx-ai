// apps/web/src/components/purchasing/vendor-bill/vendor-bill-actions.tsx
'use client'

// The bill's lifecycle cluster (73 D4), in the shape the invoice and the quote
// already use: one primary segment plus a dropdown of everything else.
//
// ```
// draft ──[Post]──▶ posted ──[Edit]──▶ editing ──[Save]──▶ posted
//                    └──[Void]──▶ void      └──[Cancel]──▶ posted
// ```
//
// The primary segment IS the next move, so there is only ever one to reach for.
// Void sits in the menu behind a confirm, because it is the destructive one and
// it is offered at every stage a bill is still correctable.

import type { EditStamp } from '@auxx/lib/resources/client'
import type { RecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Ban, Pencil, Save, Undo2, Upload } from 'lucide-react'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { useRecordStore } from '~/components/resources/store/record-store'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

export interface VendorBillActionsProps {
  billRecordId: RecordId
  /** `vendor_bill_status`. */
  status: string
  /** True while an edit snapshot row stands — the lock is lifted. */
  editing: boolean
}

export function VendorBillActions({ billRecordId, status, editing }: VendorBillActionsProps) {
  const [confirmVoid, VoidConfirmDialog] = useConfirm()
  const [confirmCancel, CancelConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const updateRecord = useRecordStore((state) => state.updateRecord)
  const [defId, vendorBillId] = billRecordId.split(':')

  // The three lane mutations return the stamp, so the store is patched without
  // waiting on the realtime echo or a refetch (74 §1.2.1).
  const stampEdit = (edit: EditStamp | null) => {
    if (defId && vendorBillId) updateRecord(defId, vendorBillId, { edit })
  }
  const refreshLedgerState = () =>
    utils.purchasing.billLedgerState
      .invalidate({ vendorBillId: vendorBillId ?? '' })
      .catch(() => {})

  const target = { family: 'vendor_bill' as const, recordId: vendorBillId ?? '' }

  const postBill = api.purchasing.postVendorBill.useMutation({
    // Under an avenue with auto-post off this leaves a DRAFT, and the ledger
    // card reads the pointer to it off `billLedgerState`.
    onSuccess: refreshLedgerState,
    onError: (error) => toastError({ title: 'Error posting bill', description: error.message }),
  })
  const openEdit = api.documentEdit.open.useMutation({
    onSuccess: (edit) => stampEdit(edit),
    onError: (error) => toastError({ title: 'Error opening bill', description: error.message }),
  })
  const saveEdit = api.documentEdit.save.useMutation({
    onSuccess: (result) => {
      stampEdit(result.edit)
      refreshLedgerState()
    },
    onError: (error) => toastError({ title: 'Error saving bill', description: error.message }),
  })
  const cancelEdit = api.documentEdit.cancel.useMutation({
    onSuccess: (result) => {
      stampEdit(result.edit)
      // Restore rewrote header values and deleted the lines the edit added, so
      // every value the drawer holds for this bill is stale.
      utils.record.invalidate().catch(() => {})
    },
    onError: (error) => toastError({ title: 'Error cancelling edit', description: error.message }),
  })
  const voidBill = api.purchasing.voidVendorBill.useMutation({
    onSuccess: refreshLedgerState,
    onError: (error) => toastError({ title: 'Error voiding bill', description: error.message }),
  })

  const handleCancelEdit = async () => {
    const confirmed = await confirmCancel({
      title: 'Discard these changes?',
      description:
        'The bill returns to the values it had when Edit was pressed. Lines added since are ' +
        'deleted. The ledger was never touched.',
      confirmText: 'Discard changes',
      cancelText: 'Keep editing',
      destructive: true,
    })
    if (confirmed) cancelEdit.mutate(target)
  }

  const handleVoid = async () => {
    const confirmed = await confirmVoid({
      title: 'Void this bill?',
      description:
        'Its general ledger entry is reversed and its lines return to billable on the order. ' +
        'A void bill is corrected by raising a new one.',
      confirmText: 'Void',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) voidBill.mutate({ vendorBillId: vendorBillId ?? '' })
  }

  const primary = (() => {
    if (status === 'draft') {
      return {
        label: 'Post',
        onClick: () => postBill.mutate({ vendorBillId: vendorBillId ?? '' }),
        isPending: postBill.isPending,
      }
    }
    if (status !== 'posted') return undefined
    return editing
      ? {
          label: 'Save',
          onClick: () => saveEdit.mutate(target),
          isPending: saveEdit.isPending,
        }
      : {
          label: 'Edit',
          onClick: () => openEdit.mutate(target),
          isPending: openEdit.isPending,
        }
  })()

  const canVoid = status !== 'void' && status !== 'draft' && !editing

  return (
    <>
      <DocumentSectionActions
        badge={
          editing ? (
            <Badge variant='amber' size='sm'>
              Editing
            </Badge>
          ) : undefined
        }>
        <DocumentActionsCluster send={primary} menuLabel='Bill actions'>
          {status === 'draft' && (
            <DropdownMenuItem onClick={() => postBill.mutate({ vendorBillId: vendorBillId ?? '' })}>
              <Upload /> Post to the ledger
            </DropdownMenuItem>
          )}
          {status === 'posted' && !editing && (
            <DropdownMenuItem onClick={() => openEdit.mutate(target)}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          {status === 'posted' && editing && (
            <>
              <DropdownMenuItem onClick={() => saveEdit.mutate(target)}>
                <Save /> Save
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCancelEdit}>
                <Undo2 /> Cancel changes
              </DropdownMenuItem>
            </>
          )}
          {canVoid && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={handleVoid}>
                <Ban /> Void
              </DropdownMenuItem>
            </>
          )}
        </DocumentActionsCluster>
      </DocumentSectionActions>
      <VoidConfirmDialog />
      <CancelConfirmDialog />
    </>
  )
}
