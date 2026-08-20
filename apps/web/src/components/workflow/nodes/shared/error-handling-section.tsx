// apps/web/src/components/workflow/nodes/shared/error-handling-section.tsx

'use client'

import {
  ErrorStrategy,
  getManifest,
  normalizeErrorStrategy,
  type TargetBranch,
} from '@auxx/lib/workflow-engine/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import type { ReactNode } from 'react'
import { useCallback } from 'react'
import { useEdgeInteractions, useReadOnly } from '~/components/workflow/hooks'
import Section from '~/components/workflow/ui/section'

/** What the node persists when a strategy is picked. */
export interface ErrorStrategyUpdate {
  error_strategy: ErrorStrategy
  _targetBranches: TargetBranch[]
}

export interface ErrorHandlingSectionProps {
  /** Canvas node id — needed to drop fail-branch edges when the policy changes. */
  nodeId: string
  /** The persisted `data.type`, i.e. the manifest id whose declaration drives this. */
  nodeType: string
  /** Raw persisted `error_strategy` — may be absent, or the legacy `'none'`. */
  errorStrategy: unknown
  /** Persist the picked strategy and the branches it derives. */
  onChange: (update: ErrorStrategyUpdate) => void
  /** The node's own defaults editor, rendered only under the `default` policy. */
  children?: ReactNode
  /** Extra content shown under every policy (validation messages, hints). */
  footer?: ReactNode
  className?: string
}

/** Copy for each policy. Written once so every node type says the same thing. */
const STRATEGY_COPY: Record<ErrorStrategy, { label: string; description: string }> = {
  [ErrorStrategy.fail]: {
    label: 'Fail branch',
    description: 'Stop this path and route to the fail branch',
  },
  [ErrorStrategy.continue]: {
    label: 'Continue',
    description: 'Carry on with the error as this node’s output',
  },
  [ErrorStrategy.default]: {
    label: 'Default values',
    description: 'Substitute the values below and carry on',
  },
}

/**
 * The one failure-policy control, driven by `manifest.errorHandling.strategies`.
 *
 * Plan 21 §15.4 asked for this and steps 1–3 deliberately skipped it, so until
 * PR B there were two bespoke selectors — http's `components/error-handling.tsx`
 * and crud's inline `<Select>` in `panel.tsx` — offering different labels for
 * the same three values, and the six node types opted in by step 4 had no way
 * to be configured at all.
 *
 * It renders only the policies the manifest declares, which is the point of the
 * declaration being per type: `default` needs an output shape worth
 * substituting (http has a response body, `ai` has `text`), and a chunker has
 * no meaningful "default chunks", so the option simply never appears there.
 *
 * A type with no `errorHandling` declaration renders NOTHING — that absence is
 * the explicit statement "a failure here is fatal", not an oversight.
 *
 * Built on `Section` + `<Select>` in the `actions` slot, matching the two
 * selectors it replaces and the rest of the node panels. It is not a
 * `FieldPanelRow`, so the `FieldInputAdapter` rule (`docs/ui-design-guide.md`
 * §5) does not apply — the workflow panels' own primitive is `Section`/`Field`.
 *
 * The per-node defaults editors are passed as `children` and are deliberately
 * NOT touched here: plan 24 owns their redesign.
 */
export function ErrorHandlingSection({
  nodeId,
  nodeType,
  errorStrategy,
  onChange,
  children,
  footer,
  className,
}: ErrorHandlingSectionProps) {
  const { isReadOnly } = useReadOnly()
  const { handleEdgeDeleteByDeleteBranch } = useEdgeInteractions()
  const errorHandling = getManifest(nodeType)?.errorHandling

  // Read through the normalizer: persisted http nodes carry `'none'`, the
  // legacy spelling of `continue` (plan 21 §15.1), and an unset value runs
  // under whatever the manifest declares as its `defaultStrategy`.
  const current = normalizeErrorStrategy(errorStrategy, errorHandling?.defaultStrategy)

  const setStrategy = useCallback(
    (raw: string) => {
      const next = raw as ErrorStrategy
      if (!errorHandling?.strategies.includes(next)) return

      onChange({
        error_strategy: next,
        _targetBranches:
          next === ErrorStrategy.fail
            ? [
                { id: 'source', name: '', type: 'default' },
                { id: 'fail', name: 'Fail', type: 'fail' },
              ]
            : [{ id: 'source', name: '', type: 'default' }],
      })

      // Leaving `fail` retires the branch, so any edge on it would dangle on a
      // handle the node no longer renders.
      if (current === ErrorStrategy.fail && next !== ErrorStrategy.fail) {
        handleEdgeDeleteByDeleteBranch(nodeId, 'fail')
      }
    },
    [current, errorHandling, handleEdgeDeleteByDeleteBranch, nodeId, onChange]
  )

  if (!errorHandling) return null

  // A type that declares exactly one policy has nothing to pick — plan 24 §6.5
  // retired `continue` from every type whose outputs are the reason it exists,
  // so `[fail]` is now the common case. A one-item `<Select>` reads as a
  // choice that is being withheld; the copy alone is the honest rendering.
  const onlyStrategy = errorHandling.strategies.length === 1 ? errorHandling.strategies[0] : null

  return (
    <Section
      className={className}
      title='Error handling'
      collapsible={current === ErrorStrategy.default}
      open={current === ErrorStrategy.default}
      actions={
        onlyStrategy ? (
          <span className='text-sm text-primary-500'>{STRATEGY_COPY[onlyStrategy].label}</span>
        ) : (
          <Select value={current} onValueChange={setStrategy} disabled={isReadOnly}>
            <SelectTrigger variant='default' size='sm' className='mb-0'>
              <SelectValue placeholder='Select strategy' />
            </SelectTrigger>
            <SelectContent>
              {errorHandling.strategies.map((strategy) => (
                <SelectItem
                  key={strategy}
                  value={strategy}
                  description={STRATEGY_COPY[strategy].description}>
                  {STRATEGY_COPY[strategy].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }>
      {current === ErrorStrategy.default && children}
      {current === ErrorStrategy.fail && (
        <div className='text-sm text-primary-500'>Wire the Fail branch on the canvas.</div>
      )}
      {footer}
    </Section>
  )
}
