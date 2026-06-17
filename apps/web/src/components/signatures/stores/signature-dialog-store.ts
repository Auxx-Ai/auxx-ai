// apps/web/src/components/signatures/stores/signature-dialog-store.ts
'use client'

import { create } from 'zustand'

interface SignatureDialogState {
  open: boolean
  /** Signature id for edit mode; null = create. */
  signatureId: string | null

  openCreate: () => void
  openEdit: (signatureId: string) => void
  close: () => void
}

/**
 * Global store for the signature create/edit dialog so it can be opened from
 * anywhere (the settings page and the command palette). Mounted once via
 * {@link SignatureDialogRoot}.
 */
export const useSignatureDialogStore = create<SignatureDialogState>((set) => ({
  open: false,
  signatureId: null,
  openCreate: () => set({ open: true, signatureId: null }),
  openEdit: (signatureId) => set({ open: true, signatureId }),
  close: () => set({ open: false, signatureId: null }),
}))
