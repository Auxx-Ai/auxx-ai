// apps/web/src/components/records/hooks/use-record-shortcuts.ts
'use client'

import { parseRecordId, type RecordId } from '@auxx/types/resource'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useState } from 'react'
import { useFavoriteToggle } from '~/components/favorites/hooks/use-favorite-toggle'
import { useRecordAccess } from '~/components/resources'

/**
 * The record counterpart of mail's `use-focused-thread-shortcuts`.
 *
 * ## The bindings, and why each one is that key
 *
 * | Key | Action | Gate |
 * |---|---|---|
 * | `R` | Request access | `access === 'read'` — below it the surface never opened, above it there is nothing left to ask for |
 * | `F` | Toggle favourite | none; a favourite is a personal bookmark keyed to the viewer, not a write on the record |
 * | `W` | Run workflow | none; running one is the `view` rung (same reasoning as `WorkflowSubMenu`) |
 * | `Shift+S` | Share | `canShare` — an `admin` row |
 * | `E` | Expand to full page | `onExpand` provided (drawer only) |
 *
 * 🔴 **`Shift+S`, not `S`.** Fifteen command-palette chords begin with `s`
 * (`s,g`, `s,m`, `s,w`, …), and `@tanstack/hotkeys` runs its `HotkeyManager` and
 * `SequenceManager` as two independent `keydown` listeners with no cross-talk —
 * so a plain `S` binding fires immediately AND leaves the chord buffer armed.
 * Pressing `S`→`G` for Settings → General would open the share dialog on the way
 * past. `floating-compose-root.tsx` solves the same collision for `C` by
 * deferring 500ms and cancelling on a `c`-chord; that latency is worth paying for
 * compose and is not worth paying for a share dialog.
 *
 * ## What this hook does NOT own
 *
 * `R` and `Shift+S` return controlled state rather than rendering anything,
 * because both targets need a mounted anchor or an existing dialog:
 * `RecordRequestAccessPopover` must anchor to a visible trigger, and the share
 * dialog already exists on both surfaces. Only the workflow dialog is created
 * here, since it has neither constraint.
 *
 * ## Mounting rule
 *
 * **Exactly one mount per visible record**, or every key fires twice —
 * `conflictBehavior: 'allow'` means "both handlers run", not "one wins". The
 * detail page mounts it in `DetailViewActions`; the drawer mounts it in
 * `RecordDrawer`. Those two never coexist (the record detail page does not mount
 * a `RecordDrawer`).
 *
 * ⚠ **In the mailbox the caller MUST pass `enabled: false`.** `mail-box.tsx`
 * docks a `RecordDrawer` (the ticket drawer) beside a live thread, and mail binds
 * `R` to reply-all (`thread-details.tsx:196`), `F` to forward
 * (`thread-details.tsx:204`) and `W` to its own workflow dialog. All three would
 * double-fire. `useIsNestedThread()` is the signal — `NestedThreadProvider`
 * exists for exactly this and already wraps that mount.
 */
export interface RecordShortcutsOptions {
  /**
   * Undefined disables every binding, so a surface whose record resolves a beat
   * after mount can still call this hook unconditionally (React requires it).
   */
  recordId: RecordId | undefined
  /**
   * False suppresses every binding. Pass `open && !useIsNestedThread()` from a
   * drawer; a detail page can usually pass `true`.
   */
  enabled: boolean
  /** Open the full page. `E` is not bound when omitted — the detail page IS the full page. */
  onExpand?: () => void
}

export interface RecordShortcuts {
  /** Controlled open for this surface's `RecordRequestAccessPopover` (`R`). */
  requestAccessOpen: boolean
  setRequestAccessOpen: (open: boolean) => void
  /** Controlled open for this surface's `InstanceShareDialog` (`Shift+S`). */
  shareOpen: boolean
  setShareOpen: (open: boolean) => void
  /** Controlled open for the workflow dialog (`W`). The surface renders it. */
  workflowOpen: boolean
  setWorkflowOpen: (open: boolean) => void
}

export function useRecordShortcuts({
  recordId,
  enabled,
  onExpand,
}: RecordShortcutsOptions): RecordShortcuts {
  const parsed = recordId ? parseRecordId(recordId) : null
  const { access, canShare } = useRecordAccess(recordId)
  const active = enabled && !!parsed

  const [requestAccessOpen, setRequestAccessOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)

  const { toggle: toggleFavorite, isPending: isFavoritePending } = useFavoriteToggle(
    'ENTITY_INSTANCE',
    parsed
      ? { entityDefinitionId: parsed.entityDefinitionId, entityInstanceId: parsed.entityInstanceId }
      : null
  )

  // R — request the next rung. Same gate as the visible trigger, so the key can
  // never open a popover the surface decided not to render.
  useHotkey('R', () => setRequestAccessOpen(true), {
    enabled: active && access === 'read',
    conflictBehavior: 'allow',
  })

  // F — toggle favourite. Guarded on `isPending` so a held key cannot queue an
  // add and a remove against the same row.
  const onFavorite = useCallback(() => {
    if (!isFavoritePending) toggleFavorite()
  }, [isFavoritePending, toggleFavorite])
  useHotkey('F', onFavorite, { enabled: active, conflictBehavior: 'allow' })

  // W — run a workflow. Matches mail's `W` on threads; the two never coexist
  // while `enabled` is false in the mailbox.
  useHotkey('W', () => setWorkflowOpen(true), { enabled: active, conflictBehavior: 'allow' })

  // Shift+S — share. See the 🔴 note above for why it is not plain `S`.
  useHotkey('Shift+S', () => setShareOpen(true), {
    enabled: active && canShare,
    conflictBehavior: 'allow',
  })

  // E — expand to the full page.
  useHotkey('E', () => onExpand?.(), {
    enabled: active && !!onExpand,
    conflictBehavior: 'allow',
  })

  return {
    requestAccessOpen,
    setRequestAccessOpen,
    shareOpen,
    setShareOpen,
    workflowOpen,
    setWorkflowOpen,
  }
}
