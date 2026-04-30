// apps/web/src/components/kb/hooks/use-draft-settings-autosave.ts
'use client'

import type { KBDraftSettings } from '@auxx/lib/kb/client'
import { deepEqual } from '@auxx/utils/objects'
import { useCallback, useEffect, useRef, useState } from 'react'
import { registerSettingsSubmit } from '../ui/settings/settings-submit-registry'
import { useKnowledgeBaseMutations } from './use-knowledge-base-mutations'

type SubsetOfDraft = Partial<KBDraftSettings>

interface AutosaveOptions {
  delayMs?: number
  /** Skip autosave (e.g. while RHF is still hydrating defaults). */
  enabled?: boolean
  /**
   * If set, the hook registers its `flush` under this key with the global
   * settings-submit registry. The KB sidebar's Save button calls every
   * registered handler in parallel.
   */
  registryKey?: string
}

interface AutosaveResult {
  isSaving: boolean
  lastSavedAt: Date | null
  /** Force-flush any pending diff immediately. Useful on unmount-like events. */
  flush: () => Promise<void>
}

function diffPatch(prev: SubsetOfDraft, next: SubsetOfDraft): SubsetOfDraft {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(next)) {
    const a = (prev as Record<string, unknown>)[k]
    const b = (next as Record<string, unknown>)[k]
    if (!deepEqual(a, b)) out[k] = b
  }
  return out as SubsetOfDraft
}

/**
 * Watch a section's form values and flush any diff into the KB draft envelope
 * via `kb.updateDraftSettings`. Calls are debounced (default 500ms) and
 * coalesced — typing in a hex input does NOT fire one request per keystroke.
 */
export function useDraftSettingsAutosave(
  kbId: string | undefined,
  watch: SubsetOfDraft,
  opts: AutosaveOptions = {}
): AutosaveResult {
  const { delayMs = 500, enabled = true, registryKey } = opts
  const { updateDraftSettings } = useKnowledgeBaseMutations()

  const baselineRef = useRef<SubsetOfDraft>(watch)
  const inflightRef = useRef<SubsetOfDraft>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const watchRef = useRef<SubsetOfDraft>(watch)
  watchRef.current = watch

  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  // Re-baseline when the kb id changes (switching KBs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are intentionally not deps
  useEffect(() => {
    baselineRef.current = watchRef.current
    inflightRef.current = {}
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [kbId])

  const flush = useCallback(async () => {
    if (!kbId) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const patch = diffPatch(baselineRef.current, watchRef.current)
    if (Object.keys(patch).length === 0) return
    inflightRef.current = patch
    const optimisticBaseline = { ...baselineRef.current, ...patch }
    baselineRef.current = optimisticBaseline
    setIsSaving(true)
    try {
      await updateDraftSettings(kbId, patch as KBDraftSettings)
      setLastSavedAt(new Date())
    } catch {
      // Roll back the local baseline so the next watch tick re-detects the diff.
      baselineRef.current = { ...baselineRef.current }
      for (const k of Object.keys(patch)) {
        ;(baselineRef.current as Record<string, unknown>)[k] = (
          watchRef.current as Record<string, unknown>
        )[k]
      }
    } finally {
      inflightRef.current = {}
      setIsSaving(false)
    }
  }, [kbId, updateDraftSettings])

  const watchKey = JSON.stringify(watch)
  // biome-ignore lint/correctness/useExhaustiveDependencies: watchKey is the stringified diff trigger; flush is stable via useCallback
  useEffect(() => {
    if (!enabled || !kbId) return
    const patch = diffPatch(baselineRef.current, watch)
    if (Object.keys(patch).length === 0) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void flush()
    }, delayMs)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [watchKey, enabled, kbId, delayMs, flush])

  // Register with the global settings-submit registry so the sidebar Save
  // button can force-flush this section's pending diff.
  useEffect(() => {
    if (!registryKey || !kbId) return
    return registerSettingsSubmit(`${kbId}:${registryKey}`, flush)
  }, [registryKey, kbId, flush])

  // Best-effort flush on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only fires on KB id change / unmount
  useEffect(() => {
    return () => {
      if (!kbId) return
      const patch = diffPatch(baselineRef.current, watchRef.current)
      if (Object.keys(patch).length === 0) return
      void updateDraftSettings(kbId, patch as KBDraftSettings)
    }
  }, [kbId])

  return { isSaving, lastSavedAt, flush }
}
