// apps/web/src/components/inbox/inbox-dialog.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav } from '@auxx/ui/components/dialog-nav'
import type { InboxItem } from '~/components/threads/hooks'
import { InboxForm } from './inbox-form'

/** Props for InboxDialog */
interface InboxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** RecordId for edit mode, null/undefined for create mode */
  recordId?: RecordId | null
  /** Called after successful save */
  onSuccess?: (inbox: { id: string; name: string; recordId: RecordId }) => void
  /** Called after a successful deletion. */
  onDeleted?: () => void
  /** Scoped metadata for edit mode. */
  inboxSummary?: Pick<InboxItem, 'id' | 'entityDefinitionKey' | 'isPersonal' | 'ownerUserId'>
  /** Whether the shared-inbox delete action should be rendered. */
  canDelete?: boolean
}

/**
 * Modal wrapper around {@link InboxForm}, a two-page `DialogNav` flow mirroring the
 * webhook endpoint dialog: `configure` (name/color/access) and `members` (the
 * "People & groups" drill). The command palette hosts the same form as a single
 * page (inline grantee list). Public API is unchanged.
 */
export function InboxDialog({
  open,
  onOpenChange,
  recordId,
  onSuccess,
  onDeleted,
  inboxSummary,
  canDelete,
}: InboxDialogProps) {
  const isEditing = !!recordId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <InboxForm
          open={open}
          recordId={recordId}
          onSuccess={onSuccess}
          onDeleted={onDeleted}
          inboxSummary={inboxSummary}
          canDelete={canDelete}
          onClose={() => onOpenChange(false)}
          enableMembersPage
          header={({ title, page, onBack }) => (
            <DialogNav
              title={title}
              description={
                isEditing
                  ? 'Update inbox settings.'
                  : 'Create a new inbox to organize your messages.'
              }
              onBack={page === 'members' ? onBack : undefined}
              crumbs={[
                { label: title, onClick: page !== 'main' ? onBack : undefined },
                ...(page === 'members' ? [{ label: 'People & groups' }] : []),
              ]}
            />
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
