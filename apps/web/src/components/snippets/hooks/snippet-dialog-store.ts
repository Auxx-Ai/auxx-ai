// apps/web/src/components/snippets/hooks/snippet-dialog-store.ts
'use client'

import { create } from 'zustand'

interface SnippetDialogState {
  open: boolean
  /** Folder to create the snippet in (optional). */
  folderId: string | null

  openCreate: (folderId?: string | null) => void
  close: () => void
}

/**
 * Global store for the "Create Snippet" dialog so it can be opened from anywhere
 * (the snippets settings page and the command palette). Mounted once via
 * {@link SnippetDialogRoot}. Edit/copy stay page-local (they need the page's
 * selection context); only create is promoted to a global surface.
 */
export const useSnippetDialogStore = create<SnippetDialogState>((set) => ({
  open: false,
  folderId: null,
  openCreate: (folderId = null) => set({ open: true, folderId }),
  close: () => set({ open: false, folderId: null }),
}))
