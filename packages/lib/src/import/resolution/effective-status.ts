// packages/lib/src/import/resolution/effective-status.ts

import type { OverrideValue } from '../types/resolution'

/** Resolution status as `ImportValueResolution.status` stores it */
export type ResolutionStatus = 'pending' | 'valid' | 'error' | 'warning' | 'create'

/** Effective status includes 'skip' for user-skipped values */
export type EffectiveStatus = ResolutionStatus | 'skip'

/**
 * What a reviewed value's status becomes once the user's override is applied.
 *
 * The review step groups on `originalStatus` (so a value stays in the group it
 * was found in) and DISPLAYS `effectiveStatus`, which means the rule has to be
 * evaluated twice: once by the server read, and once optimistically by the row
 * that just wrote an override. Both call this — a second copy is how the chip
 * and the group headline drift apart while both look authoritative.
 *
 * Pure, and deliberately client-safe (`@auxx/lib/import/client`).
 *
 * @param originalStatus - The stored resolver verdict
 * @param isOverridden - Whether the user has overridden this value
 * @param overrideValues - The override payload; a leading `skip` means "import nothing"
 * @returns The status to display
 */
export function deriveEffectiveStatus(
  originalStatus: ResolutionStatus,
  isOverridden: boolean,
  overrideValues: OverrideValue[] | null | undefined
): EffectiveStatus {
  const first = overrideValues?.[0]
  if (!isOverridden || !first) return originalStatus
  if (first.type === 'skip') return 'skip'
  return 'valid'
}

/**
 * The option key(s) a value will actually import as: the override when the user
 * set one, otherwise the resolver's own answer.
 *
 * A `skip` override imports nothing, so it yields no keys at all rather than
 * falling back to the resolver — the row renders "Skipped", not a stale chip.
 *
 * @param resolvedValue - The resolver's answer (comma-joined for multi columns)
 * @param isOverridden - Whether the user has overridden this value
 * @param overrideValues - The override payload
 * @returns The keys behind the effective value, in order
 */
export function effectiveOptionKeys(
  resolvedValue: string | null | undefined,
  isOverridden: boolean,
  overrideValues: OverrideValue[] | null | undefined
): string[] {
  if (isOverridden && overrideValues?.length) {
    if (overrideValues[0]?.type === 'skip') return []
    return overrideValues.map((override) => override.value).filter(Boolean)
  }
  // Option keys are nanoids and never contain commas, so the join is reversible.
  return (resolvedValue ?? '').split(',').filter(Boolean)
}
