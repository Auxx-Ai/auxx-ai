// apps/web/src/components/global/calc-formula/calc-tokens-used.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
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
 *
 * Always rendered (even with no tokens) so the surrounding form doesn't shift as
 * tokens come and go — an empty placeholder badge holds the row's height.
 */
export function CalcTokensUsed({
  tokens,
  tokenSource,
  label = 'Fields used',
}: CalcTokensUsedProps) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className='flex flex-wrap gap-1'>
        {tokens.length === 0 ? (
          <Badge variant='outline' className='text-muted-foreground'>
            None yet
          </Badge>
        ) : (
          tokens.map((token) => <span key={token}>{tokenSource.renderBadge(token, false)}</span>)
        )}
      </div>
    </Field>
  )
}
