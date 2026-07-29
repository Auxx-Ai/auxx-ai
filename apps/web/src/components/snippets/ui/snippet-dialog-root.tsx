// apps/web/src/components/snippets/ui/snippet-dialog-root.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { useSnippetDialogStore } from '../hooks/snippet-dialog-store'
import { SnippetForm } from './snippet-form'

/**
 * Root-level renderer for the global "Create Snippet" dialog. Mount once at the
 * app layout level so snippets can be created from anywhere (settings page +
 * command palette). Driven by {@link useSnippetDialogStore}. `SnippetForm` owns
 * its own mutations + cache invalidation.
 */
export function SnippetDialogRoot() {
  const open = useSnippetDialogStore((s) => s.open)
  const folderId = useSnippetDialogStore((s) => s.folderId)
  const close = useSnippetDialogStore((s) => s.close)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position='tc' size='xxl' innerClassName='max-h-[90vh] overflow-auto'>
        <DialogHeader className='mb-4'>
          <DialogTitle>Create Snippet</DialogTitle>
        </DialogHeader>
        {open && (
          <SnippetForm
            initialValues={{ folderId: folderId ?? undefined }}
            onSuccess={close}
            onCancel={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
