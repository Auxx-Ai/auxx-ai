// apps/web/src/components/purchasing/intake/hooks/use-intake-pointer.ts
'use client'

// The `localStorage` pointer that is the ONLY way back to an in-flight quote
// draft (plans/money/tasks/38 §6.1).
//
// ⚠️ Device-local by design, and that is written down rather than discovered:
// the draft is server-side because the worker writes it while the tab may be
// closed, but nothing indexes "my open drafts" and no `listDrafts` procedure
// exists or should be built. Upload on the laptop and the draft is invisible on
// the phone.
//
// A pointer therefore outlives its draft: the draft expires off a 24h Redis TTL
// and nothing tells the browser. Every reader must treat a not-found as "forget
// this pointer", never as an error.
//
// Every read is defensive. `localStorage` throws in a private window with site
// data blocked, and the stored blob is whatever a previous version of this file
// wrote — a parse that trusts its shape turns a stale key into a crashed
// purchase orders page.

import {
  INTAKE_POINTER_STORAGE_KEY,
  type IntakeDraftPointer,
} from '@auxx/lib/purchasing/intake/client'
import { useCallback, useEffect, useState } from 'react'

/** Cross-component notification: `storage` only fires in OTHER tabs. */
const POINTERS_CHANGED_EVENT = 'auxx:purchasing-intake-pointers'

function readPointers(): IntakeDraftPointer[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(INTAKE_POINTER_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is IntakeDraftPointer =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as IntakeDraftPointer).draftId === 'string'
    )
  } catch {
    return []
  }
}

function writePointers(pointers: IntakeDraftPointer[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(INTAKE_POINTER_STORAGE_KEY, JSON.stringify(pointers))
  } catch {
    // A browser that refuses site data loses the banner, not the draft — the
    // review URL still works and the server row is untouched.
  }
  window.dispatchEvent(new Event(POINTERS_CHANGED_EVENT))
}

/** Record a freshly started draft. Newest first, and never duplicated. */
export function addIntakePointer(pointer: IntakeDraftPointer): void {
  const existing = readPointers().filter((p) => p.draftId !== pointer.draftId)
  writePointers([pointer, ...existing])
}

/** Forget a draft: committed, discarded, or gone from the server. */
export function removeIntakePointer(draftId: string): void {
  writePointers(readPointers().filter((p) => p.draftId !== draftId))
}

/**
 * The pointers this device is holding, kept in step with writes from any
 * component in this tab and from other tabs.
 *
 * Starts empty on the server render and fills in on mount, so the banner never
 * causes a hydration mismatch.
 */
export function useIntakePointers(): IntakeDraftPointer[] {
  const [pointers, setPointers] = useState<IntakeDraftPointer[]>([])

  const sync = useCallback(() => setPointers(readPointers()), [])

  useEffect(() => {
    sync()
    window.addEventListener(POINTERS_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(POINTERS_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])

  return pointers
}
