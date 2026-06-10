// apps/web/src/components/evals/ui/eval-assertion-result-row.tsx
'use client'

import type { AssertionResult } from '@auxx/types/evals'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { useState } from 'react'
import { EvalStatusDot, EvalStatusPill } from './eval-status-pill'

/**
 * One graded assertion in a run's Verdict list. Shared by agent Simulations and
 * workflow Tests (the assertion-result envelope is kind-agnostic). `error`
 * renders amber via the shared pill and reads "grading could not complete" —
 * never as a soft fail. The judge rationale / error note expands inline.
 *
 * See plans/evals/ui-plan.md §"Level 3 — run detail + trace".
 */

const TYPE_LABELS: Record<string, string> = {
  terminal_outcome: 'Terminal outcome',
  procedure_selected: 'Procedure selected',
  response_criteria: 'Response criteria',
  crm_field: 'CRM field',
  local_variable: 'Local variable',
  tool_called: 'Tool called',
  tool_not_called: 'Tool not called',
  // workflow kinds (Phase 2B) reuse this row:
  workflow_status: 'Workflow status',
  node_output: 'Node output',
  execution_count: 'Execution count',
  no_errors: 'No errors',
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

/** Best-effort one-line description of what the assertion expected. */
function expectedSummary(result: AssertionResult): string | null {
  const def = result.definition as { data?: Record<string, unknown> } | null
  const data = def?.data
  if (!data) return null
  if (typeof data.outcome === 'string') return `expects ${data.outcome}`
  if (typeof data.toolName === 'string') return data.toolName
  if (typeof data.name === 'string') return data.name
  if (Array.isArray(data.criteria)) return `${data.criteria.length} criteria`
  if ('expected' in data) return `expects ${formatValue(data.expected)}`
  return null
}

function formatValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** LLM-judge verdict shape (response_criteria / terminal_outcome / …). */
type JudgeActual = { rationale: string; evidenceEventIds: string[] }
function asJudgeActual(value: unknown): JudgeActual | null {
  if (value == null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.rationale !== 'string') return null
  const ids = Array.isArray(v.evidenceEventIds)
    ? v.evidenceEventIds.filter((x): x is string => typeof x === 'string')
    : []
  return { rationale: v.rationale, evidenceEventIds: ids }
}

/** Tool-match verdict shape (tool_called / tool_not_called). */
type ToolActual = { toolName: string; args?: unknown }
function asToolActual(value: unknown): ToolActual | null {
  if (value == null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.toolName !== 'string') return null
  return { toolName: v.toolName, args: v.args }
}

interface EvalAssertionResultRowProps {
  result: AssertionResult
  /** 0-based indent; also aligns the expanded detail under the row title. */
  depth?: number
}

export function EvalAssertionResultRow({ result, depth = 0 }: EvalAssertionResultRowProps) {
  const [open, setOpen] = useState(false)
  const expected = expectedSummary(result)
  const judge = asJudgeActual(result.actual)
  const tool = asToolActual(result.actual)
  const hasDetail = Boolean(result.note) || result.actual != null

  return (
    <TreeRow
      depth={depth}
      icon={<EvalStatusDot status={result.status} />}
      title={typeLabel(result.type)}
      secondary={
        <span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
          {expected ? <span className='truncate'>{expected}</span> : null}
          <EvalStatusPill status={result.status} />
        </span>
      }
      expandable={hasDetail}
      isOpen={open}
      onToggleOpen={() => setOpen((v) => !v)}>
      <div
        className='space-y-2 py-1.5 pe-2 text-xs'
        style={{ paddingLeft: `${0.5 + (depth + 1) * 1.5}rem` }}>
        {judge ? (
          <>
            <p className={result.status === 'error' ? 'text-amber-600' : 'text-foreground'}>
              {judge.rationale}
            </p>
            {judge.evidenceEventIds.length > 0 ? (
              <div className='flex flex-wrap items-center gap-1'>
                <span className='text-muted-foreground'>Evidence:</span>
                {judge.evidenceEventIds.map((id) => (
                  <span
                    key={id}
                    title={id}
                    className='rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
                    {id.replace(/^evt-/, '').slice(0, 6)}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : tool ? (
          <div className='space-y-1'>
            <div>
              <span className='text-muted-foreground'>Tool: </span>
              <span className='font-mono'>{tool.toolName}</span>
            </div>
            {tool.args !== undefined ? (
              <pre className='overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px]'>
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : result.actual !== undefined ? (
          <div>
            <span className='text-muted-foreground'>Actual: </span>
            <span className='font-mono break-all'>{formatValue(result.actual)}</span>
          </div>
        ) : null}
        {/* `note` duplicates the judge rationale on a failed criterion — only show it
            when there's no judge verdict already rendering that text. */}
        {result.note && !judge ? (
          <p className={result.status === 'error' ? 'text-amber-600' : 'text-muted-foreground'}>
            {result.status === 'error' ? 'Grading could not complete: ' : ''}
            {result.note}
          </p>
        ) : null}
      </div>
    </TreeRow>
  )
}
