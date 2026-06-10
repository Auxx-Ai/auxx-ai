// apps/web/src/components/evals/ui/messages/eval-trace-markdown.ts

import type { EvalTraceEvent } from '@auxx/types/evals'
import type { ToolCallView } from './eval-trace-grouping'
import { groupTrace } from './eval-trace-grouping'

/**
 * Pure serialization of an agent-simulation trace into copy-paste Markdown —
 * the same conversation `EvalTraceView` renders, flattened for an LLM or a bug
 * report. Reuses {@link groupTrace} so the markdown and the on-screen trace
 * never drift (same turns, same tool-call args/output/resolution badge).
 *
 * A brief metadata header (status, verdict sentence, assertion tally, time
 * span) precedes the trace; tool calls carry fenced JSON args, their output
 * summary, and the resolution badge; non-message notices (terminal, errors,
 * config/snapshot warnings) fold in as italic blockquotes in sequence.
 */

export interface TraceMarkdownMeta {
  /** Terminal/in-flight run status, e.g. `passed`. */
  status?: string
  /** The verdict sentence shown in the banner (with any error appended). */
  summary?: string
  /** Per-status assertion tally for the header. */
  assertions?: { passed: number; failed: number; error: number }
}

/** Prefix every line of a (possibly multi-line) block with `> ` for a blockquote. */
function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
}

function fencedJson(value: unknown): string {
  let body: string
  try {
    body = JSON.stringify(value, null, 2)
  } catch {
    body = String(value)
  }
  return ['```json', body, '```'].join('\n')
}

function toolCallMarkdown(call: ToolCallView): string {
  const parts = [`**Tool call — \`${call.name}\`** _(${call.badge.label})_`]
  if (Object.keys(call.args).length > 0) {
    parts.push('', 'Args:', fencedJson(call.args))
  }
  parts.push('', `Result: ${call.summary ? call.summary : '_(no output)_'}`)
  return parts.join('\n')
}

/** Mirror of the notice card's `present()` — a one-line label + optional detail. */
function noticeMarkdown(event: EvalTraceEvent): string {
  const data = event.data
  const message = typeof data.message === 'string' ? data.message : undefined

  switch (event.type) {
    case 'terminal': {
      const outcome = typeof data.terminalOutcome === 'string' ? data.terminalOutcome : 'none'
      const detail = data.capExceeded === true ? 'Customer-turn cap reached' : `Outcome: ${outcome}`
      return blockquote(`_Terminal_ — ${detail}`)
    }
    case 'execution_error':
      return blockquote(`_Execution error_${message ? ` — ${message}` : ''}`)
    default: {
      const title = event.type.replace(/_/g, ' ')
      return blockquote(`_${title}_${message ? ` — ${message}` : ''}`)
    }
  }
}

function header(trace: EvalTraceEvent[], meta?: TraceMarkdownMeta): string {
  const lines = ['# Eval run trace', '']
  if (meta?.status) lines.push(`- **Status:** ${meta.status}`)
  if (meta?.summary) lines.push(`- **Verdict:** ${meta.summary}`)
  if (meta?.assertions) {
    const { passed, failed, error } = meta.assertions
    if (passed + failed + error > 0) {
      lines.push(`- **Assertions:** ${passed} passed · ${failed} failed · ${error} error`)
    }
  }
  const stamps = trace
    .map((e) => e.timestamp)
    .filter(Boolean)
    .sort()
  const first = stamps[0]
  const last = stamps[stamps.length - 1]
  if (first) lines.push(`- **Time:** ${first}${last && last !== first ? ` → ${last}` : ''}`)
  lines.push(`- **Events:** ${trace.length}`)
  return lines.join('\n')
}

/** Serialize a trace (already-grouped via {@link groupTrace}) into Markdown. */
export function traceToMarkdown(trace: EvalTraceEvent[], meta?: TraceMarkdownMeta): string {
  const sections = [header(trace, meta), '---']

  for (const turn of groupTrace(trace)) {
    if (turn.kind === 'customer') {
      sections.push(['**Customer**', '', blockquote(turn.text || '_(empty message)_')].join('\n'))
      continue
    }

    const body: string[] = ['**Agent**', '']
    for (const run of turn.runs) {
      if (run.kind === 'agent_text') {
        body.push(run.text || '_(empty message)_', '')
      } else if (run.kind === 'tool_calls') {
        for (const call of run.calls) body.push(toolCallMarkdown(call), '')
      } else {
        body.push(noticeMarkdown(run.event), '')
      }
    }
    sections.push(body.join('\n').trimEnd())
  }

  return `${sections.join('\n\n')}\n`
}
