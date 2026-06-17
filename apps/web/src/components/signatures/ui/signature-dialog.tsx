// apps/web/src/components/signatures/ui/signature-dialog.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { SignatureForm } from './signature-form'

/** Props for SignatureDialog */
interface SignatureDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Signature id (instance id) for edit mode; null/undefined = create */
  signatureId?: string | null
  /** Called after a successful save with the saved signature id (for auto-select) */
  onSuccess?: (signatureId: string) => void
}

/**
 * Thin modal wrapper around {@link SignatureForm}. Supplies the `Dialog` shell and
 * the header; all form logic lives in the core, which the command palette hosts
 * directly as a page. Public API is unchanged.
 */
export function SignatureDialog({
  open,
  onOpenChange,
  signatureId,
  onSuccess,
}: SignatureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='xxl' innerClassName='max-h-[90vh] overflow-auto'>
        <SignatureForm
          open={open}
          signatureId={signatureId}
          onSuccess={onSuccess}
          onClose={() => onOpenChange(false)}
          header={({ title }) => (
            <DialogHeader className='mb-4'>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
