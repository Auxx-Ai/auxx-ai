// apps/web/src/components/evals/stores/use-eval-run-store.ts
'use client'

import type { AssertionResult, EvalRunStatus, EvalTraceEvent } from '@auxx/types/evals'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

/**
 * Run-keyed live state for an eval run, fed by the SSE recovery route
 * (`/api/eval/run/[runId]/events`). The store owns the `EventSource`, dedupes
 * trace events by id, and tracks the resume cursor (`lastSequence`). It never
 * decides run status from a transport failure: `connectionStatus` is separate
 * from `status`, and on error/close the caller falls back to `eval.getRun` and
 * pushes the authoritative row in via {@link hydrateFromRun}.
 *
 * Selectors only (CLAUDE.md Zustand rule) — every consumer reads through
 * {@link useEvalRunState} / {@link useEvalRunActions}, never the whole store.
 */

export type EvalConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface EvalRunLiveState {
  status: EvalRunStatus | null
  trace: EvalTraceEvent[]
  assertionResults: AssertionResult[]
  lastSequence: number
  connectionStatus: EvalConnectionStatus
}

const EMPTY_STATE: EvalRunLiveState = {
  status: null,
  trace: [],
  assertionResults: [],
  lastSequence: -1,
  connectionStatus: 'idle',
}

interface InternalRunState extends EvalRunLiveState {
  source: EventSource | null
  /** Trace event ids already merged — dedupes the persisted/live overlap. */
  seen: Set<string>
}

interface EvalRunStore {
  runs: Record<string, InternalRunState>
  connect: (runId: string) => void
  disconnect: (runId: string) => void
  /** Merge the authoritative persisted row (initial seed + SSE-failure fallback). */
  hydrateFromRun: (
    runId: string,
    row: { status: EvalRunStatus; trace: EvalTraceEvent[]; assertionResults: AssertionResult[] }
  ) => void
}

function ensure(state: EvalRunStore['runs'], runId: string): InternalRunState {
  return state[runId] ?? { ...EMPTY_STATE, source: null, seen: new Set() }
}

const TERMINAL: ReadonlySet<EvalRunStatus> = new Set<EvalRunStatus>([
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
])

export const useEvalRunStore = create<EvalRunStore>((set, get) => {
  /** Patch one run's slice immutably. */
  const patch = (runId: string, next: Partial<InternalRunState>) => {
    set((s) => ({ runs: { ...s.runs, [runId]: { ...ensure(s.runs, runId), ...next } } }))
  }

  /** Merge a batch of trace events, deduping by id and advancing the cursor. */
  const mergeTrace = (runId: string, events: EvalTraceEvent[]) => {
    const cur = ensure(get().runs, runId)
    const seen = new Set(cur.seen)
    const fresh: EvalTraceEvent[] = []
    let maxSeq = cur.lastSequence
    for (const e of events) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
      fresh.push(e)
      if (e.sequence > maxSeq) maxSeq = e.sequence
    }
    if (fresh.length === 0 && maxSeq === cur.lastSequence) return
    const trace = [...cur.trace, ...fresh].sort((a, b) => a.sequence - b.sequence)
    patch(runId, { trace, seen, lastSequence: maxSeq })
  }

  return {
    runs: {},

    connect: (runId) => {
      const existing = get().runs[runId]
      if (existing?.source) return // already streaming
      const after = existing?.lastSequence ?? -1
      patch(runId, { connectionStatus: 'connecting' })

      const source = new EventSource(`/api/eval/run/${runId}/events?afterSequence=${after}`)
      patch(runId, { source })

      source.addEventListener('connected', () => patch(runId, { connectionStatus: 'connected' }))

      source.addEventListener('trace', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as { event: EvalTraceEvent }
        mergeTrace(runId, [data.event])
      })

      source.addEventListener('status', (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as {
          status: EvalRunStatus
          assertionResults?: AssertionResult[]
        }
        patch(runId, {
          status: data.status,
          ...(data.assertionResults ? { assertionResults: data.assertionResults } : {}),
        })
      })

      source.addEventListener('done', () => {
        source.close()
        patch(runId, { source: null, connectionStatus: 'closed' })
      })

      source.onerror = () => {
        // A terminal run's stream closes normally; only flag mid-run drops as errors.
        const cur = ensure(get().runs, runId)
        const terminal = cur.status != null && TERMINAL.has(cur.status)
        source.close()
        patch(runId, { source: null, connectionStatus: terminal ? 'closed' : 'error' })
      }
    },

    disconnect: (runId) => {
      const cur = get().runs[runId]
      cur?.source?.close()
      if (cur) patch(runId, { source: null, connectionStatus: 'idle' })
    },

    hydrateFromRun: (runId, row) => {
      const cur = ensure(get().runs, runId)
      const seen = new Set(cur.seen)
      const fresh = row.trace.filter((e) => !seen.has(e.id))
      for (const e of fresh) seen.add(e.id)
      const trace = [...cur.trace, ...fresh].sort((a, b) => a.sequence - b.sequence)
      const lastSequence = trace.reduce((m, e) => Math.max(m, e.sequence), cur.lastSequence)
      patch(runId, {
        status: row.status,
        assertionResults: row.assertionResults,
        trace,
        seen,
        lastSequence,
      })
    },
  }
})

/** Selector: the public live state for one run (stable empty default when absent). */
export function useEvalRunState(runId: string | null): EvalRunLiveState {
  return useEvalRunStore((s) => (runId ? (s.runs[runId] ?? EMPTY_STATE) : EMPTY_STATE))
}

/** Selector: the store actions (shallow-compared so the object ref stays stable). */
export function useEvalRunActions() {
  return useEvalRunStore(
    useShallow((s) => ({
      connect: s.connect,
      disconnect: s.disconnect,
      hydrateFromRun: s.hydrateFromRun,
    }))
  )
}
