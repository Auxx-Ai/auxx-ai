// apps/web/src/components/manufacturing/stock-setup/kind-check.ts

// What Stock setup step 1 flags, as pure helpers: step 1 lists these rows, and the count step
// marks the same parts with a warning (plans/mrp/22 F3).

import { PartKind } from '@auxx/lib/resources/client'
import { isPartKindUnclassified } from '~/components/drawers/cards/part-family-suggestion'
import type { RouterInputs, RouterOutputs } from '~/trpc/react'

export type OpeningStockKind = RouterInputs['purchasing']['bulkSetPartKind']['kind']
type KindConflict = RouterOutputs['builds']['kindConflicts'][number]
type Candidate = RouterOutputs['purchasing']['listOpeningStockCandidates'][number]

export function toOpeningStockKind(value: unknown): OpeningStockKind | null {
  const first = Array.isArray(value) ? value[0] : value
  if (first === 'component' || first === 'subassembly' || first === 'finished_good') return first
  return null
}

export function partKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Unclassified'
  return PartKind.values.find((option) => option.value === kind)?.label ?? kind
}

export interface KindRow {
  partId: string
  name: string
  currentKind: string | null
  suggestedKind: OpeningStockKind
  /** Why the kind looks wrong, in plain words. */
  reason: string
  /** Label of the "this kind is intended" action. */
  keepLabel: string
  /** A BOM conflict (17 D3) keeps via the conflict flag; the rest re-write their kind. */
  isConflict: boolean
}

function listNames(names: string[]): string {
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

export function conflictRow(conflict: KindConflict): KindRow {
  const suggestedKind = toOpeningStockKind(conflict.suggestedKind) ?? 'component'
  const suggested = partKindLabel(suggestedKind)
  const reason =
    conflict.reason === 'component_with_bom'
      ? `Has its own parts list, but marked Component. Parts built from other parts are usually ${suggested}s.`
      : `Used inside ${listNames(conflict.usedIn.map((p) => p.partName ?? p.partId)) || 'another part'}, but marked Finished Good. Parts used inside another part are usually ${suggested}s.`
  return {
    partId: conflict.partId,
    name: conflict.partName ?? conflict.partId,
    currentKind: conflict.kind,
    suggestedKind,
    reason,
    keepLabel: conflict.reason === 'finished_good_in_bom' ? 'Sold as-is too, keep it' : 'Keep it',
    isConflict: true,
  }
}

/** Sold as a product, inside nothing, still on the default kind: suggested Finished Good. */
function isUnconfirmedKind(candidate: Candidate): boolean {
  return (
    candidate.hasProduct &&
    !candidate.isSubpartOfAssembly &&
    !candidate.kindConfirmed &&
    isPartKindUnclassified(candidate.partKind)
  )
}

/** Step 1's list: BOM conflicts first, then unconfirmed kinds not already listed. */
export function kindCheckRows(
  conflicts: readonly KindConflict[],
  candidates: readonly Candidate[]
): KindRow[] {
  const conflictRows = conflicts.map(conflictRow)
  const seen = new Set(conflictRows.map((row) => row.partId))
  const unconfirmed = candidates
    .filter((c) => !seen.has(c.partId) && isUnconfirmedKind(c))
    .map<KindRow>((c) => ({
      partId: c.partId,
      name: c.title || c.sku || c.partId,
      currentKind: toOpeningStockKind(c.partKind),
      suggestedKind: 'finished_good',
      reason:
        'Sold as a product and used inside nothing, but marked Component. Parts sold as they are are usually Finished Goods.',
      keepLabel: `Keep ${partKindLabel(toOpeningStockKind(c.partKind) ?? 'component')}`,
      isConflict: false,
    }))
  return [...conflictRows, ...unconfirmed]
}
