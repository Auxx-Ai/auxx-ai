// packages/lib/src/resources/crud/__tests__/door-matrix.test.ts

import { describe, expect, it } from 'vitest'
import {
  DOOR_MATRIX,
  type DoorPolicy,
  SYNC_SMALL_RUN_THRESHOLD,
  WORKFLOW_AUTO_DISPATCH_THRESHOLD,
  WRITE_ORIGIN_KINDS,
} from '../door-matrix'

/**
 * Door matrix coverage (write-context plan Phase 1).
 *
 * Every door decides a policy for EVERY write origin, asserted as exact set
 * equality in both directions — same coupling pattern as the workflow
 * catalog's `NodeType <-> NOT_YET_MIGRATED` coverage test. So:
 *   - adding a door without deciding every origin's cell fails;
 *   - adding an origin kind without revisiting every door fails;
 *   - a stray key that is not a declared origin fails.
 * This alone would have caught the dedup miss, the importer realtime gap, and
 * the dead workflow door (`docs/skip-events-history.md`).
 */
describe('door matrix coverage', () => {
  const doors = Object.entries(DOOR_MATRIX)
  const originKinds = new Set<string>(WRITE_ORIGIN_KINDS)

  it('decides every origin cell for every door, exactly once', () => {
    const failures = doors
      .map(([doorId, entry]) => {
        const keys = new Set(Object.keys(entry.policies))
        const missing = [...originKinds].filter((kind) => !keys.has(kind))
        const extra = [...keys].filter((key) => !originKinds.has(key))
        return { doorId, missing, extra }
      })
      .filter(({ missing, extra }) => missing.length > 0 || extra.length > 0)
    expect(failures).toEqual([])
  })

  it('keeps seed silent: off or batched, per-record only for inline derived-state doors', () => {
    // Seed never fans out (D-10 batches integrity; everything user-facing is
    // off). The two per-record exceptions are inline derived-state maintenance
    // that is part of the write itself, not fan-out: the explicit updatedAt
    // stamp on create (D-7) and searchText/display/inverse recompute.
    const perRecordAllowed = new Set(['updatedAtStamp', 'searchTextDisplayInverse'])
    const violations = doors
      .filter(([doorId, entry]) => {
        const policy: DoorPolicy = entry.policies.seed
        if (typeof policy === 'object') return false // { off } is always fine
        if (policy === 'batched') return false
        if (policy === 'per-record') return !perRecordAllowed.has(doorId)
        return true // 'guarded' (or anything new) is never a seed policy
      })
      .map(([doorId, entry]) => ({ doorId, seed: entry.policies.seed }))
    expect(violations).toEqual([])
  })

  it('gives every off cell a non-empty reason', () => {
    const missingReasons = doors.flatMap(([doorId, entry]) =>
      Object.entries(entry.policies)
        .filter(
          ([, policy]) =>
            typeof policy === 'object' &&
            (typeof policy.off !== 'string' || policy.off.length === 0)
        )
        .map(([kind]) => ({ doorId, kind }))
    )
    expect(missingReasons).toEqual([])
  })

  it('keeps both lane thresholds positive integers', () => {
    for (const threshold of [SYNC_SMALL_RUN_THRESHOLD, WORKFLOW_AUTO_DISPATCH_THRESHOLD]) {
      expect(Number.isInteger(threshold)).toBe(true)
      expect(threshold).toBeGreaterThan(0)
    }
  })
})
