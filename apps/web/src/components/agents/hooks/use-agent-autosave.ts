// apps/web/src/components/agents/hooks/use-agent-autosave.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutosaveState } from '../ui/shared/autosave-indicator'
import { useAgentMutations } from './use-agent-mutations'

interface AgentUpdatePatch {
  name?: string
  description?: string | null
  modelId?: string | null
  mentionable?: boolean
  prompt?: Record<string, unknown>
}

interface UseAgentAutosaveOptions {
  /** Notified whenever the autosave state changes (saving / saved / idle). Hoist into the page header. */
  onStateChange?: (state: AutosaveState) => void
}

interface UseAgentAutosaveReturn {
  /** Current autosave state — exposes to inline indicators (otherwise use onStateChange). */
  state: AutosaveState
  /** Debounced field patch — coalesces consecutive calls within `debounceMs`. */
  patch: (input: AgentUpdatePatch, opts?: { debounceMs?: number }) => void
  /** Flush any queued patch immediately. */
  flush: () => Promise<void>
}

/**
 * Debounced patch wrapper around `api.agent.update`. Field-level callers
 * pass a partial; the hook coalesces concurrent calls within `debounceMs`
 * (default 600ms) and fires one mutation per flush.
 *
 * The `state` value drives the page-header `AutosaveIndicator`. The hook
 * keeps the state local but also calls `onStateChange` for parents that
 * want to hoist a single indicator (matches phase-1-ui-tabs.md §2.1).
 */
export function useAgentAutosave(
  agentId: string,
  { onStateChange }: UseAgentAutosaveOptions = {}
): UseAgentAutosaveReturn {
  const { updateAgent } = useAgentMutations()
  const [state, setState] = useState<AutosaveState>({ kind: 'idle' })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedPatchRef = useRef<AgentUpdatePatch | null>(null)
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
      const ok = await updateAgent(agentId, patch)
      if (ok) {
        setStateAndNotify({ kind: 'saved', at: Date.now() })
      } else {
        setStateAndNotify({ kind: 'idle' })
      }
    } catch (err) {
      setStateAndNotify({ kind: 'idle' })
      toastError({ title: 'Save failed', description: (err as Error).message })
    }
  }, [agentId, updateAgent, setStateAndNotify])

  const patch = useCallback(
    (input: AgentUpdatePatch, opts?: { debounceMs?: number }) => {
      queuedPatchRef.current = { ...queuedPatchRef.current, ...input }
      if (timerRef.current) clearTimeout(timerRef.current)
      const ms = opts?.debounceMs ?? 600
      timerRef.current = setTimeout(() => {
        void flush()
      }, ms)
    },
    [flush]
  )

  // Flush any pending patch on unmount so a fast tab-away doesn't drop edits.
  useEffect(() => {
    return () => {
      if (queuedPatchRef.current) void flush()
    }
  }, [flush])

  return { state, patch, flush }
}
