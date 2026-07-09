// apps/web/src/components/workflow/nodes/core/if-else/trace-renderer.tsx

'use client'

import { getOperatorDefinition, type Operator } from '@auxx/lib/conditions/client'
import { cn } from '@auxx/ui/lib/utils'
import { Check, GitBranch, X } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface EvaluatedCondition {
  operator: Operator
  target: unknown
  resolvedValue: unknown
  result: boolean
}

interface EvaluatedCase {
  caseId: string
  logicalOperator: 'and' | 'or'
  matched: boolean
  conditions: EvaluatedCondition[]
}

interface IfElseOutputs {
  matched?: boolean
  matchedCase?: string | null
  caseIndex?: number
  /** Only the cases the engine actually reached (short-circuits at the match). */
  evaluatedCases?: EvaluatedCase[]
}

function operatorLabel(op: Operator): string {
  return getOperatorDefinition(op)?.label ?? String(op)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Preview for If / Else node executions. Displays the cases the engine actually
 * evaluated (it short-circuits at the first match, so trailing cases are absent),
 * each condition with its resolved value and ✓/✗ — read straight from
 * `outputs.evaluatedCases`, never re-computed client-side.
 */
export function IfElseTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as IfElseOutputs
  const cases = outputs.evaluatedCases
  const branchLabel = outputs.matchedCase ?? (outputs.matched ? 'True' : 'No match')

  const header = {
    'data-slot': 'if-else-trace-renderer',
    indicator: <GitBranch className='size-3 text-muted-foreground' />,
    primaryText: 'If / Else',
    secondaryText: `→ ${branchLabel}`,
  } as const

  // Legacy run without evaluatedCases — show just the branch line.
  if (!Array.isArray(cases) || cases.length === 0) {
    return <BlockCard {...header} hasFooter={false} />
  }

  return (
    <BlockCard {...header} hasFooter={false}>
      <div className='space-y-2 p-1'>
        {cases.map((c, i) => (
          <div
            key={c.caseId ?? i}
            className={cn(
              'rounded-xl px-2 py-1.5 ring-1',
              c.matched ? 'bg-emerald-500/5 ring-emerald-500/30' : 'bg-background ring-border'
            )}>
            <div className='mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
              <span>{c.caseId || `Case ${i + 1}`}</span>
              {c.conditions.length > 1 && (
                <span className='text-[10px] uppercase tracking-wide text-neutral-400'>
                  {c.logicalOperator}
                </span>
              )}
              {c.matched && <span className='text-emerald-600 dark:text-emerald-400'>matched</span>}
            </div>
            <div className='space-y-1'>
              {c.conditions.map((cond, j) => (
                <div key={j} className='flex items-center gap-1.5 text-sm'>
                  {cond.result ? (
                    <Check className='size-3.5 shrink-0 text-emerald-500' />
                  ) : (
                    <X className='size-3.5 shrink-0 text-neutral-400' />
                  )}
                  <span className='truncate font-medium'>{formatValue(cond.resolvedValue)}</span>
                  <span className='shrink-0 text-neutral-400'>{operatorLabel(cond.operator)}</span>
                  <span className='truncate font-medium'>{formatValue(cond.target)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </BlockCard>
  )
}
