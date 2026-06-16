// apps/web/src/components/global/new-message-indicator/store.ts
import { create } from 'zustand'

/**
 * Single source of truth for the out-of-tab new-message indicator (favicon dot
 * + tab-title prefix). Shared with the in-app toast cue
 * (`use-message-arrival-cue`) so the two surfaces never contradict each other:
 * the same arrival that fires a toast flips `hasUnseen`, and opening a thread /
 * refocusing on mail clears both.
 *
 * Binary only — no count. Session-state today; becomes server-backed once the
 * sibling plan wires live `mail-counts-store` deltas.
 */
interface NewMessageIndicatorState {
  hasUnseen: boolean
  markUnseen: () => void
  clearUnseen: () => void
}

export const useNewMessageIndicatorStore = create<NewMessageIndicatorState>((set) => ({
  hasUnseen: false,
  markUnseen: () => set((s) => (s.hasUnseen ? s : { hasUnseen: true })),
  clearUnseen: () => set((s) => (s.hasUnseen ? { hasUnseen: false } : s)),
}))

/** Imperative accessors for non-React callers (e.g. the arrival-cue callback). */
export const markUnseenMessages = () => useNewMessageIndicatorStore.getState().markUnseen()
export const clearUnseenMessages = () => useNewMessageIndicatorStore.getState().clearUnseen()
