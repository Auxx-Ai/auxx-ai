// apps/web/src/components/purchasing/vendor-bill/vendor-bill-actions.tsx
'use client'

// The bill's lifecycle cluster (73 D4), in the shape the invoice and the quote
// already use: one primary segment plus a dropdown of everything else.
//
// ```
// draft ──[Post]──▶ posted ──[Edit]──▶ editing ──[Save]──▶ posted
//                    └──[Void]──▶ void
// ```
//
// The primary segment IS the next move, so there is only ever one to reach for.
// Void sits in the menu behind a confirm, because it is the destructive one and
// it is offered at every stage a bill is still correctable.

import type { RecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Ban, Pencil, Save, Upload } from 'lucide-react'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

export interface VendorBillActionsProps {
  billRecordId: RecordId
  /** `vendor_bill_status`. */
  status: string
  /** True while `metadata.editOpen` is set — the lock is lifted. */
  editing: boolean
}

export function VendorBillActions({ billRecordId, status, editing }: VendorBillActionsProps) {
  const [confirmVoid, VoidConfirmDialog] = useConfirm()
  const utils = api.useUtils()
  const vendorBillId = instanceIdOf(billRecordId)

  const refreshEditState = () =>
    utils.purchasing.billEditState.invalidate({ vendorBillId }).catch(() => {})

  const postBill = api.purchasing.postVendorBill.useMutation({
    onError: (error) => toastError({ title: 'Error posting bill', description: error.message }),
  })
  const openEdit = api.purchasing.openBillEdit.useMutation({
    onSuccess: refreshEditState,
    onError: (error) => toastError({ title: 'Error opening bill', description: error.message }),
  })
  const saveEdit = api.purchasing.saveBillEdit.useMutation({
    onSuccess: refreshEditState,
    onError: (error) => toastError({ title: 'Error saving bill', description: error.message }),
  })
  const voidBill = api.purchasing.voidVendorBill.useMutation({
    onSuccess: refreshEditState,
    onError: (error) => toastError({ title: 'Error voiding bill', description: error.message }),
  })

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
    if (confirmed) voidBill.mutate({ vendorBillId })
  }

  const primary = (() => {
    if (status === 'draft') {
      return {
        label: 'Post',
        onClick: () => postBill.mutate({ vendorBillId }),
        isPending: postBill.isPending,
      }
    }
    if (status !== 'posted') return undefined
    return editing
      ? {
          label: 'Save',
          onClick: () => saveEdit.mutate({ vendorBillId }),
          isPending: saveEdit.isPending,
        }
      : {
          label: 'Edit',
          onClick: () => openEdit.mutate({ vendorBillId }),
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
            <DropdownMenuItem onClick={() => postBill.mutate({ vendorBillId })}>
              <Upload /> Post to the ledger
            </DropdownMenuItem>
          )}
          {status === 'posted' && !editing && (
            <DropdownMenuItem onClick={() => openEdit.mutate({ vendorBillId })}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          {status === 'posted' && editing && (
            <DropdownMenuItem onClick={() => saveEdit.mutate({ vendorBillId })}>
              <Save /> Save
            </DropdownMenuItem>
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
    </>
  )
}

/** The bill's own instance id — every purchasing procedure takes that, not a `RecordId`. */
function instanceIdOf(recordId: RecordId): string {
  const [, instanceId] = recordId.split(':')
  return instanceId ?? recordId
}
