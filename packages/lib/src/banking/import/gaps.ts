// packages/lib/src/banking/import/gaps.ts

import { type CoverageGap, daysBetween, shiftDateKey } from '../client'

/**
 * One stored coverage gap, minus the range a file has just filled.
 *
 * Answers zero, one or two gaps:
 *
 * ```
 * gap      |--------------------|
 * file            |--------|            => two gaps, one either side
 * file  |------------|                  => one gap, the tail
 * file        |--------------------|    => none, the gap is closed
 * file                              |-| => the gap, untouched
 * ```
 *
 * 🛑 Pure, and the ONLY thing an import is allowed to do to the stored gap list.
 * The stored list is TESTIMONY - "we imported January and it really was empty" -
 * where the derived list (`computeCoverageGaps`) is inference, and `readCoverage`
 * lets the stored one win on overlap for exactly that reason. An import may
 * retire testimony it has just disproved; it may never write new testimony from
 * a heuristic.
 *
 * ⚠️ A partially covered gap is SHRUNK, not dropped. A file that closes the
 * first six weeks of a nine-week hole leaves a three-week hole, and reporting no
 * hole at all is how a balance sheet spanning it renders happily and is wrong
 * (plans/bank-connection/01 §4.1 (4c)).
 */
export function subtractCoveredRange(
  gap: CoverageGap,
  from: string | null,
  to: string | null
): CoverageGap[] {
  if (!gap?.from || !gap?.to) return []
  if (daysBetween(gap.from, gap.to) < 0) return []
  if (!from || !to) return [gap]
  if (daysBetween(from, to) < 0) return [gap]

  // No intersection at all.
  if (daysBetween(to, gap.from) > 0 || daysBetween(gap.to, from) > 0) return [gap]

  const remaining: CoverageGap[] = []
  if (daysBetween(gap.from, from) > 0) {
    remaining.push({ from: gap.from, to: shiftDateKey(from, -1) })
  }
  if (daysBetween(to, gap.to) > 0) {
    remaining.push({ from: shiftDateKey(to, 1), to: gap.to })
  }
  return remaining
}
