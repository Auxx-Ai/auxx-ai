// apps/web/src/components/money/ui/credit-memo/credit-memo-lines-card.tsx
'use client'

// Credit memo drawer's "Lines" card, registered as 'credit_memo:lines'
// (plans/accounting/tasks/10-credit-memos.md §6.2). The invoice lines card's
// recipe: the document actions cluster teleported into the drawer Section
// header via `DocumentSectionActions`, the source badge, and the shared
// `LineBuilder` in `documentType='credit_memo'` mode.
//
// Lifecycle (§2.4): while `draft` the primary slot is Issue (a confirm dialog
// showing the entry) and the lines are editable; once `issued` or `settled` the
// primary slot is Send and the lines are frozen. The menu carries Download PDF,
// Void (issued or settled, refused server-side once anything was applied or
// refunded) and Discard (draft only, the generic `record.delete`).

import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Ban, Download, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import {
  DocumentActionsCluster,
  DocumentSectionActions,
} from '~/components/money/ui/document-actions-cluster'
import { LineBuilder } from '~/components/money/ui/line-builder/line-builder'
import { useDocumentSendActions } from '~/components/money/ui/use-document-send-actions'
import { useSystemValues } from '~/components/resources/hooks'
import { useConfirm } from '~/hooks/use-confirm'
import { useSettings } from '~/hooks/use-settings'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { IssueCreditMemoDialog } from './issue-credit-memo-dialog'

const CREDIT_MEMO_ATTRS = [
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_issued_at',
] as const

/** Statuses where the memo is a posted document that can be sent or voided. */
const ISSUED_STATUSES = new Set(['issued', 'settled'])

function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

export function CreditMemoLinesCard({ recordId }: DrawerTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [issueOpen, setIssueOpen] = useState(false)
  const { can } = useAccess()

  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const { values } = useSystemValues(recordId, [...CREDIT_MEMO_ATTRS], { autoFetch: true })
  const status = (unwrap(values.credit_memo_status) as string | undefined) ?? 'draft'
  const source = (unwrap(values.credit_memo_source) as string | undefined) ?? 'native'
  const issuedAtValue = unwrap(values.credit_memo_issued_at)
  const issuedAt = typeof issuedAtValue === 'string' ? issuedAtValue : null

  // draft is the only editable state; issued, settled and void are frozen.
  const readOnly = status !== 'draft'
  const isIssued = ISSUED_STATUSES.has(status)
  // Issue and void both post (HANDOFF slot 2K's rule for the write-off): gated
  // on `ledger.post`. The server enforces it; the UI hides what would 403.
  const canPost = can('ledger.post')

  const utils = api.useUtils()
  const invalidate = () => {
    void utils.creditMemo.settlement.invalidate({ creditMemoRecordId: recordId })
  }

  const { hasEmailChannel, handleSend, handleDownload, isSending } = useDocumentSendActions(
    recordId,
    'credit memo'
  )

  const voidCreditMemo = api.creditMemo.void.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error voiding credit memo', description: error.message }),
  })
  // Discard is a plain record delete (§2.4): the delete guard refuses anything
  // but a draft, and a channel draft is voided by the guard's own path rather
  // than deleted, so the connector cannot resurrect it. Nothing memo-specific
  // to call.
  const discardCreditMemo = api.record.delete.useMutation({
    onError: (error) =>
      toastError({ title: 'Error discarding credit memo', description: error.message }),
  })

  const handleVoid = async () => {
    const confirmed = await confirm({
      title: 'Void this credit memo?',
      description:
        'The issue entry is reversed in the ledger. A memo with credit applied or refunded cannot be voided; unapply first.',
      confirmText: 'Void',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) voidCreditMemo.mutate({ creditMemoRecordId: recordId })
  }

  const handleDiscard = async () => {
    const confirmed = await confirm({
      title: 'Discard this draft?',
      description:
        source === 'channel'
          ? 'The draft is voided without posting. The connector will not recreate it on the next sync.'
          : 'The draft and its lines are deleted. This cannot be undone.',
      confirmText: 'Discard',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) discardCreditMemo.mutate({ recordId })
  }

  const primarySlot =
    status === 'draft'
      ? canPost
        ? {
            label: 'Issue',
            onClick: () => setIssueOpen(true),
            isPending: false,
          }
        : undefined
      : isIssued
        ? {
            label: 'Send',
            onClick: handleSend,
            isPending: isSending,
            disabledReason: hasEmailChannel ? undefined : (
              <div className='flex flex-col gap-1 text-xs'>
                <span>Connect an email channel to send credit memos.</span>
                <Link href='/app/settings/channels' className='underline'>
                  Go to channel settings
                </Link>
              </div>
            ),
          }
        : undefined

  return (
    <div className='flex h-[26rem] min-h-0 flex-col'>
      <DocumentSectionActions
        badge={
          source === 'channel' ? (
            <Badge variant='purple' size='sm'>
              Channel
            </Badge>
          ) : undefined
        }>
        <DocumentActionsCluster send={primarySlot} menuLabel='Credit memo actions'>
          <DropdownMenuItem onClick={handleDownload}>
            <Download /> Download PDF
          </DropdownMenuItem>

          {isIssued && canPost && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={handleVoid}>
                <Ban /> Void
              </DropdownMenuItem>
            </>
          )}

          {status === 'draft' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={handleDiscard}>
                <Trash2 /> Discard
              </DropdownMenuItem>
            </>
          )}
        </DocumentActionsCluster>
      </DocumentSectionActions>

      <div className='min-h-0 flex-1 pe-3'>
        <LineBuilder documentRecordId={recordId} documentType='credit_memo' readOnly={readOnly} />
      </div>

      <IssueCreditMemoDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        creditMemoRecordId={recordId}
        issuedAt={issuedAt}
        currencyCode={currencyCode}
        onIssued={invalidate}
      />

      <ConfirmDialog />
    </div>
  )
}
