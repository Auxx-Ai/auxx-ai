// apps/web/src/components/global/calc-formula/calc-tokens-used.tsx

'use client'

import { Field, FieldLabel } from '@auxx/ui/components/field'
import type { CalcTokenSource } from './token-source'

interface CalcTokensUsedProps {
  /** The tokens referenced by the expression (validation.extractedFields). */
  tokens: string[]
  /** Renders each token's chip — reuses the same badge as the editor. */
  tokenSource: CalcTokenSource
  /** Section label (default "Fields used"). */
  label?: string
}

/**
 * The "tokens used" chip strip below a calc editor. Renders each referenced
 * token via the token source's badge, so unknown/unresolved tokens surface the
 * same way they do inside the editor (e.g. a destructive "not found" chip). Used
 * by both calc-formula consumers.
 */
export function CalcTokensUsed({
  tokens,
  tokenSource,
  label = 'Fields used',
}: CalcTokensUsedProps) {
  if (tokens.length === 0) return null
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className='flex flex-wrap gap-1'>
        {tokens.map((token) => (
          <span key={token}>{tokenSource.renderBadge(token, false)}</span>
        ))}
      </div>
    </Field>
  )
}
