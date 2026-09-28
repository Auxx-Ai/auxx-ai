// packages/lib/src/inventory/builds/kind-conflict-policy.ts
// Client-safe: the kind-conflict rule (plans/mrp/17-stock-setup-flow.md D3/D4).

import { isServicePartKind, resolvePartKind } from '../costing/client'

/** Why a part's kind disagrees with its place in the bill of materials. */
export type KindConflictReason = 'finished_good_in_bom' | 'component_with_bom'

/** The kind a conflict is fixed to; never `service`. */
export type SuggestedPartKind = 'component' | 'subassembly' | 'finished_good'

/** One part whose kind disagrees with its BOM edges and was not confirmed as intended. */
export interface KindConflict {
  partId: string
  partName: string | null
  /** The kind as readers resolve it: an unset kind reads `component`. */
  kind: string
  reason: KindConflictReason
  /** The parts whose BOM lists this one. */
  usedIn: { partId: string; partName: string | null }[]
  suggestedKind: SuggestedPartKind
}

/** What the rule needs to know about one part. */
export interface KindConflictInput {
  kind: string | null
  isSubpartOfAssembly: boolean
  hasBom: boolean
  confirmed: boolean
}

/** The kind a conflict reports: the stored kind, with unset read as `component`. */
export function resolveKindForConflict(kind: string | null): string {
  return resolvePartKind(kind)
}

/** The conflict a part would have with `kind`, or `null`. Unset reads as `component`. */
export function kindConflictFor(input: KindConflictInput): KindConflictReason | null {
  if (input.confirmed || isServicePartKind(input.kind)) return null
  const kind = resolvePartKind(input.kind)
  if (kind === 'finished_good' && input.isSubpartOfAssembly) return 'finished_good_in_bom'
  if (kind === 'component' && input.hasBom) return 'component_with_bom'
  return null
}

/** The kind that resolves `reason`; a part both inside a BOM and with its own is a subassembly. */
export function suggestedKindFor(input: {
  reason: KindConflictReason
  isSubpartOfAssembly: boolean
  hasBom: boolean
}): SuggestedPartKind {
  if (input.isSubpartOfAssembly && input.hasBom) return 'subassembly'
  return input.reason === 'finished_good_in_bom' ? 'component' : 'finished_good'
}
