// packages/lib/src/evals/model-summary.ts
//
// Model-facing condensation of an eval run (phase 5C): the raw trace envelope
// is too large and too noisy for a Kopilot turn, so `get_eval_run` serves this
// instead — chronological transcript lines, failed assertions, and nothing
// from the runtime snapshot (no tool bindings, no app-account refs). Traces
// are persisted redacted (phase 1), so the summary inherits that.
// Pure function over the run row.

import type { EvalRunEntity } from '@auxx/database'
import type { AssertionResult, EvalRunMode, EvalTraceEvent } from '@auxx/types/evals'

export interface ModelRunSummary {
  runId: string
  status: EvalRunEntity['status']
  runMode: EvalRunMode
  /** Null when the case was deleted after the run. */
  caseId: string | null
  caseName: string
  /** Non-passed assertion results (failed AND errored — both block a pass). */
  failedAssertions: {
    assertionId: string
    type: string
    status: AssertionResult['status']
    definition: unknown
    actual?: unknown
    note?: string
  }[]
  /** Condensed chronological transcript; one line per trace event. */
  transcript: string
  /** True when the middle of the transcript was dropped to fit `maxChars`. */
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 8_000
const ARGS_DIGEST_MAX = 120

/** Condense a run row for the model. See the transcript line rules in 5C.2. */
export function summarizeEvalRunForModel(
  run: EvalRunEntity,
  opts?: { maxChars?: number }
): ModelRunSummary {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS

  const definition = run.definitionSnapshot as { case?: { name?: string } } | null
  const caseName = definition?.case?.name ?? ''

  const failedAssertions = (run.assertionResults as Partial<AssertionResult>[])
    .filter(
      (r): r is AssertionResult => typeof r?.assertionId === 'string' && r.status !== 'passed'
    )
    .map((r) => ({
      assertionId: r.assertionId,
      type: r.type,
      status: r.status,
      definition: r.definition,
      ...(r.actual !== undefined ? { actual: r.actual } : {}),
      ...(r.note !== undefined ? { note: r.note } : {}),
    }))

  const events = (run.trace as Partial<EvalTraceEvent>[])
    .filter(
      (e): e is EvalTraceEvent => typeof e?.type === 'string' && typeof e.sequence === 'number'
    )
    .sort((a, b) => a.sequence - b.sequence)

  const lines = events.map(formatEventLine).filter((line): line is string => line !== null)
  const { transcript, truncated } = joinWithCap(lines, maxChars)

  if (run.error && !transcript.includes(run.error)) {
    // Runs that died before any trace landed (e.g. enqueue failures) still
    // surface their terminal error.
    return {
      runId: run.id,
      status: run.status,
      runMode: run.runMode,
      caseId: run.caseId,
      caseName,
      failedAssertions,
      transcript: transcript
        ? `${transcript}\n[run error] ${run.errorCode ?? 'ERROR'}: ${run.error}`
        : `[run error] ${run.errorCode ?? 'ERROR'}: ${run.error}`,
      truncated,
    }
  }

  return {
    runId: run.id,
    status: run.status,
    runMode: run.runMode,
    caseId: run.caseId,
    caseName,
    failedAssertions,
    transcript,
    truncated,
  }
}

/** One transcript line per trace event; null drops the event (nothing model-relevant). */
function formatEventLine(event: EvalTraceEvent): string | null {
  const data = event.data ?? {}
  switch (event.type) {
    case 'customer_message':
      return `Customer: ${String(data.text ?? '')}`
    case 'agent_message':
      return `Agent: ${String(data.text ?? '')}`
    case 'tool_call': {
      const resolution = String(data.resolution ?? '')
      const outcome = resolution === 'unmatched_error' ? 'error' : 'ok'
      const mocked = resolution === 'mock' || resolution === 'tool_example' ? ' [mocked]' : ''
      return `tool ${String(data.toolName ?? '?')}(${argsDigest(data.args)}) → ${outcome}${mocked}`
    }
    case 'execution_error':
      return `[execution error] ${String(data.message ?? '')}`
    case 'snapshot_incompatible':
    case 'code_revision_drift':
    case 'config_invalid':
      return `[system] ${event.type}${data.message ? `: ${String(data.message)}` : ''}`
    case 'terminal':
      return `[terminal] outcome=${String(data.terminalOutcome ?? 'none')} capExceeded=${String(
        data.capExceeded ?? false
      )} customerTurns=${String(data.customerTurns ?? '?')}`
    default:
      return null
  }
}

function argsDigest(args: unknown): string {
  if (args == null) return ''
  let digest: string
  try {
    digest = JSON.stringify(args)
  } catch {
    digest = String(args)
  }
  return digest.length > ARGS_DIGEST_MAX ? `${digest.slice(0, ARGS_DIGEST_MAX)}…` : digest
}

/** Join lines under the char cap, dropping from the MIDDLE (head+tail retention). */
function joinWithCap(
  lines: string[],
  maxChars: number
): { transcript: string; truncated: boolean } {
  const full = lines.join('\n')
  if (full.length <= maxChars) return { transcript: full, truncated: false }

  // Walk inward from both ends until head+tail fit, reserving marker room.
  const reserve = 40
  const budget = Math.max(maxChars - reserve, 0)
  const head: string[] = []
  const tail: string[] = []
  let used = 0
  let lo = 0
  let hi = lines.length - 1
  let takeFromHead = true
  while (lo <= hi) {
    const line = takeFromHead ? lines[lo] : lines[hi]
    const cost = (line?.length ?? 0) + 1
    if (used + cost > budget) break
    used += cost
    if (takeFromHead) {
      if (line !== undefined) head.push(line)
      lo += 1
    } else {
      if (line !== undefined) tail.unshift(line)
      hi -= 1
    }
    takeFromHead = !takeFromHead
  }

  const dropped = hi - lo + 1
  return {
    transcript: [...head, `…[truncated ${dropped} events]…`, ...tail].join('\n'),
    truncated: true,
  }
}
