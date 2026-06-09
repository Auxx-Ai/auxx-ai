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

interface EvalAssertionResultRowProps {
  result: AssertionResult
}

export function EvalAssertionResultRow({ result }: EvalAssertionResultRowProps) {
  const [open, setOpen] = useState(false)
  const expected = expectedSummary(result)
  const hasDetail = Boolean(result.note) || result.actual !== undefined

  return (
    <TreeRow
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
      <div className='space-y-2 px-2 py-1.5 text-xs'>
        {result.actual !== undefined ? (
          <div>
            <span className='text-muted-foreground'>Actual: </span>
            <span className='font-mono break-all'>{formatValue(result.actual)}</span>
          </div>
        ) : null}
        {result.note ? (
          <p className={result.status === 'error' ? 'text-amber-600' : 'text-muted-foreground'}>
            {result.status === 'error' ? 'Grading could not complete: ' : ''}
            {result.note}
          </p>
        ) : null}
      </div>
    </TreeRow>
  )
}
