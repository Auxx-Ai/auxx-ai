// apps/web/src/components/workflow/ui/variables/use-variable-array-segments.ts

'use client'

import { BaseType, type UnifiedVariable } from '@auxx/lib/workflow-engine/client'
import { useMemo } from 'react'
import { useVarStore } from '~/components/workflow/store/use-var-store'

/** Matches ONE trailing `[<int>|*]` bracket on a single dot-segment. */
const SEGMENT_BRACKET_RE = /^(.*)\[(-?\d+|\*)\]$/

/** One array in a variable's path whose access the user can change. */
export interface VariableArraySegment {
  /** The variable id up to and including this segment's key, bracket excluded. */
  basePath: string
  /** The raw path key — frequently a CUID, never render this. */
  key: string
  /** Display label resolved from the variable store, falling back to {@link key}. */
  label: string
  /** Current accessor, or `null` when the segment carries no bracket (the array itself). */
  accessor: string | null
  /** Zero-based position among this id's array segments, in path order. */
  ordinal: number
  /** Whether this is the last segment of the path. */
  isTerminal: boolean
}

/**
 * Collect the array segments of a variable id that the user can re-access.
 *
 * Deliberately store-aware rather than a regex over the id, for two reasons:
 *
 * 1. **Bare arrays are invisible to a regex.** A terminal segment can be
 *    `ARRAY`-typed with no bracket — `find_1.<cuid>` feeding a List node's
 *    Input List — and that is exactly the chip a user wants to switch to
 *    "first item". Only the resolved variable's `type` reveals it.
 * 2. **Raw keys are not display names.** A findMany output is keyed on
 *    `resource.id`, so the key is a CUID (`find_1.mzxt3cxyzhm3cbtgcbpmeir1`)
 *    while the variable's `label` is `Vendors`. Resolving `basePath` through the
 *    store is what `buildVariableLabelPath` already does for the chip itself.
 *
 * Consequence worth knowing: because eligibility is type-based and not
 * bracket-based, stripping a bracket (choosing "the whole list") keeps the
 * segment in this list. A bracket-based test would return an empty list and
 * unmount the menu mid-interaction.
 */
export function useVariableArraySegments(variableId: string): VariableArraySegment[] {
  const variableIndex = useVarStore((state) => state.variableIndex)

  return useMemo(() => {
    if (!variableId) return []

    // Mirrors `getVariableById`: the store only ever indexes the `[*]` form, so
    // an id carrying a numeric accessor has to be normalised before lookup.
    const resolve = (id: string): UnifiedVariable | undefined =>
      variableIndex.get(id) ?? variableIndex.get(id.replace(/\[-?\d+\]/g, '[*]'))

    const parts = variableId.split('.')
    const segments: VariableArraySegment[] = []

    // Start at 1 — the first segment is the node/`env`/`sys` prefix, never an array.
    for (let i = 1; i < parts.length; i++) {
      const raw = parts[i]
      if (raw === undefined) continue

      const bracket = raw.match(SEGMENT_BRACKET_RE)
      const key = bracket ? bracket[1]! : raw
      const accessor = bracket ? bracket[2]! : null
      const basePath = [...parts.slice(0, i), key].join('.')

      const variable = resolve(basePath)
      // A bracket proves it is an array. Without one, only the store can say.
      if (!bracket && variable?.type !== BaseType.ARRAY) continue

      segments.push({
        basePath,
        key,
        label: variable?.label || key,
        accessor,
        ordinal: segments.length,
        isTerminal: i === parts.length - 1,
      })
    }

    return segments
  }, [variableId, variableIndex])
}

/** Human-readable label for an accessor, including the bracket-less array itself. */
export function getAccessorLabel(accessor: string | null): string {
  if (accessor === null) return 'The whole list'
  if (accessor === '*') return 'All items'
  const index = Number.parseInt(accessor, 10)
  if (index === 0) return 'First item'
  if (index === -1) return 'Last item'
  if (index < -1) return `${ordinalLabel(Math.abs(index))} to last`
  return `${ordinalLabel(index + 1)} item`
}

/** Ordinal suffix for a number (1st, 2nd, 3rd, …). */
function ordinalLabel(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`
}
