// packages/lib/src/field-values/ai-autofill/input-hash.ts

import { createHash } from 'node:crypto'
import { type FormulaNode, formulaToString } from '../../custom-fields/formula-converters'
import type { ResolvedReference } from './reference-resolver'

/**
 * Compute a stable content hash over the resolved prompt inputs. Used for
 * stale detection: the cell overlay re-hashes on render and compares to
 * `valueJson.inputHash`; mismatch + `aiStatus='result'` means the source
 * inputs changed since the last generation.
 *
 * Hash inputs:
 *   - The prompt flattened via formulaToString (captures prose + field order)
 *   - Resolved refs sorted by fieldKey, then stringified
 *
 * Output is 16 hex chars of SHA-256 — enough collision resistance for a
 * per-(entity,field) row.
 */
export function computeInputHash(params: {
  promptJson: FormulaNode
  resolved: Map<string, ResolvedReference>
}): string {
  const { promptJson, resolved } = params

  const promptStr = formulaToString(promptJson)

  const sortedRefs = Array.from(resolved.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, ref]) => [key, ref.displayValue] as const)

  const payload = JSON.stringify({ prompt: promptStr, refs: sortedRefs })

  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}
