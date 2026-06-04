// apps/web/src/components/agents/procedures/hooks/use-procedure-autosave.ts
'use client'

import type { TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import type { AutosaveState } from '../../ui/shared/autosave-indicator'

interface ProcedureUpdatePatch {
  name?: string
  whenToUse?: string
  triggerExamples?: TriggerExample[]
  ruleset?: ConditionGroup[]
  /** The TipTap DRAFT doc — NEVER the published compiled/version. */
  doc?: Record<string, unknown>
}

interface UseProcedureAutosaveOptions {
  onStateChange?: (state: AutosaveState) => void
}

/**
 * Debounced patch wrapper around `api.procedure.update`, draft-only by
 * construction (the patch never carries `compiled`/`version` — publishing is the
 * separate explicit mutation). Clone of `use-agent-autosave.ts`; coalesces
 * consecutive patches within `debounceMs` and fires one mutation per flush.
 */
export function useProcedureAutosave(
  procedureId: string,
  { onStateChange }: UseProcedureAutosaveOptions = {}
): {
  state: AutosaveState
  patch: (input: ProcedureUpdatePatch, opts?: { debounceMs?: number }) => void
  flush: () => Promise<void>
} {
  const updateProcedure = api.procedure.update.useMutation()
  const [state, setState] = useState<AutosaveState>({ kind: 'idle' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedPatchRef = useRef<ProcedureUpdatePatch | null>(null)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const setStateAndNotify = useCallback((next: AutosaveState) => {
    setState(next)
    onStateChangeRef.current?.(next)
  }, [])

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const patch = queuedPatchRef.current
    queuedPatchRef.current = null
    if (!patch) return
    setStateAndNotify({ kind: 'saving' })
    try {
      await updateProcedure.mutateAsync({ id: procedureId, ...patch })
      setStateAndNotify({ kind: 'saved', at: Date.now() })
    } catch (err) {
      setStateAndNotify({ kind: 'idle' })
      toastError({ title: 'Save failed', description: (err as Error).message })
    }
  }, [procedureId, updateProcedure, setStateAndNotify])

  const patch = useCallback(
    (input: ProcedureUpdatePatch, opts?: { debounceMs?: number }) => {
      queuedPatchRef.current = { ...queuedPatchRef.current, ...input }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void flush(), opts?.debounceMs ?? 600)
    },
    [flush]
  )

  useEffect(() => {
    return () => {
      if (queuedPatchRef.current) void flush()
    }
  }, [flush])

  return { state, patch, flush }
}
