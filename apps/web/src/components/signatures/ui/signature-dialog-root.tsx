// apps/web/src/components/signatures/ui/signature-dialog-root.tsx
'use client'

import { useSignatureDialogStore } from '../stores/signature-dialog-store'
import { SignatureDialog } from './signature-dialog'

/**
 * Root-level renderer for the global signature create/edit dialog. Mount once at
 * the app layout level so signatures can be created from anywhere (settings page
 * + command palette). Driven by {@link useSignatureDialogStore}.
 */
export function SignatureDialogRoot() {
  const open = useSignatureDialogStore((s) => s.open)
  const signatureId = useSignatureDialogStore((s) => s.signatureId)
  const close = useSignatureDialogStore((s) => s.close)

  if (!open) return null

  return (
    <SignatureDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      signatureId={signatureId}
    />
  )
}
