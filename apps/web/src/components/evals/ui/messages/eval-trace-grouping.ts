// apps/web/src/components/evals/ui/messages/eval-trace-grouping.ts

import type { EvalTraceEvent } from '@auxx/types/evals'

/**
 * Pure projection of a chronological agent-simulation trace into conversation
 * turns — the eval analog of kopilot's `groupTurns`/`groupRuns`
 * (`assistant-message.tsx`). No React, no state: same input → same output for
 * live (SSE) and replayed traces.
 *
 * A `customer_message` opens a turn; every following non-customer event folds
 * into that turn's assistant side until the next `customer_message`. Within the
 * assistant side, contiguous `tool_call`s collapse into one run; `agent_message`
 * is a text run; everything else (terminal / errors / system) is a notice run.
 */

/** One mocked tool invocation, shaped for `ToolStatusPill` + a resolution badge. */
export interface ToolCallView {
  id: string
  name: string
  args: Record<string, unknown>
  /** One-line output preview, already coerced to a string. */
  summary?: string
  /** Where the tool result came from — drives the small trailing badge. */
  badge: { label: 'mock' | 'live' | 'captured'; live: boolean }
}

export type Run =
  | { kind: 'agent_text'; id: string; text: string }
  | { kind: 'tool_calls'; id: string; calls: ToolCallView[] }
  | { kind: 'notice'; id: string; event: EvalTraceEvent }

export type Turn =
  | { kind: 'customer'; id: string; text: string }
  | { kind: 'agent'; id: string; runs: Run[] }

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Coerce the executor's `outputSummary` (string | object | scalar) to a line. */
function summaryString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value || undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function toToolCallView(event: EvalTraceEvent): ToolCallView {
  const data = event.data
  const resolution = str(data.resolution)
  const captured = data.captured === true
  const live = resolution === 'passthrough'
  return {
    id: event.id,
    name: str(data.toolName) ?? 'tool',
    args: (data.args as Record<string, unknown>) ?? {},
    summary: summaryString(data.outputSummary),
    badge: {
      label: captured ? 'captured' : live ? 'live' : 'mock',
      live,
    },
  }
}

export function groupTrace(events: EvalTraceEvent[]): Turn[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence)
  const turns: Turn[] = []
  let agent: Extract<Turn, { kind: 'agent' }> | null = null

  // Ensure there's an open agent turn to absorb a non-customer event, creating
  // one (with no preceding customer turn) when the trace opens with a system
  // event — mirrors kopilot's leading-non-user group.
  const ensureAgent = (seedId: string) => {
    if (!agent) {
      agent = { kind: 'agent', id: seedId, runs: [] }
      turns.push(agent)
    }
    return agent
  }

  for (const event of ordered) {
    if (event.type === 'customer_message') {
      turns.push({ kind: 'customer', id: event.id, text: str(event.data.text) ?? '' })
      agent = null
      continue
    }

    const turn = ensureAgent(event.id)

    if (event.type === 'agent_message') {
      turn.runs.push({ kind: 'agent_text', id: event.id, text: str(event.data.text) ?? '' })
      continue
    }

    if (event.type === 'tool_call') {
      const last = turn.runs[turn.runs.length - 1]
      if (last?.kind === 'tool_calls') {
        last.calls.push(toToolCallView(event))
      } else {
        turn.runs.push({ kind: 'tool_calls', id: event.id, calls: [toToolCallView(event)] })
      }
      continue
    }

    // terminal / execution_error / config_invalid / snapshot_incompatible /
    // code_revision_drift / unknown → a notice run in sequence position.
    turn.runs.push({ kind: 'notice', id: event.id, event })
  }

  return turns
}
