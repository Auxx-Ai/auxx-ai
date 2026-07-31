// packages/lib/src/data-migrations/migrations/064-sequences-limit.test.ts

import { describe, expect, it } from 'vitest'
import { applySequencesLimit } from './064-sequences-limit'

/**
 * `sequencesLimit` is a NEW static-limit key, so unlike migration 063's fold there is
 * nothing in the stored data to derive it from — the migration writes a target matrix.
 * What matters is that it writes the target exactly, appends the key when a
 * hand-edited plan lacks it, and reports `changed: false` on a second pass so the
 * runner does not rewrite every plan row on every deploy.
 *
 * The DB plumbing is deliberately not exercised here (that needs a live Postgres).
 */

/** A plan's stored array as it stood BEFORE this migration (gate present, no limit key). */
function before(gate: boolean) {
  return [
    { key: 'workflowsLimit', limit: 15 },
    { key: 'sequences', limit: gate },
    { key: 'savedViews', limit: 20 },
  ]
}

describe('applySequencesLimit', () => {
  it('appends the limit key when the plan does not carry it', () => {
    const { limits, changed } = applySequencesLimit(before(false), { gate: true, limit: 3 })

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'sequencesLimit', limit: 3 })
  })

  it('opens the gate on a plan that had sequences off', () => {
    const { limits } = applySequencesLimit(before(false), { gate: true, limit: 3 })

    expect(limits).toContainEqual({ key: 'sequences', limit: true })
  })

  it('leaves Free closed at a zero limit', () => {
    const { limits } = applySequencesLimit(before(false), { gate: false, limit: 0 })

    expect(limits).toContainEqual({ key: 'sequences', limit: false })
    expect(limits).toContainEqual({ key: 'sequencesLimit', limit: 0 })
  })

  it('carries -1 through unchanged for Enterprise (the features provider maps it to "+")', () => {
    const { limits } = applySequencesLimit(before(true), { gate: true, limit: -1 })

    expect(limits).toContainEqual({ key: 'sequencesLimit', limit: -1 })
  })

  it('preserves every unrelated key and its order', () => {
    const { limits } = applySequencesLimit(before(true), { gate: true, limit: 25 })

    expect(limits.slice(0, 3).map((d) => d.key)).toEqual([
      'workflowsLimit',
      'sequences',
      'savedViews',
    ])
    expect(limits).toContainEqual({ key: 'workflowsLimit', limit: 15 })
    expect(limits).toContainEqual({ key: 'savedViews', limit: 20 })
  })

  it('is idempotent — a second pass reports no change', () => {
    const target = { gate: true, limit: 3 }
    const first = applySequencesLimit(before(false), target)
    const second = applySequencesLimit(first.limits, target)

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.limits).toEqual(first.limits)
  })

  it('rewrites a stale limit that drifted from the target', () => {
    const stale = [...before(true), { key: 'sequencesLimit', limit: 99 }]
    const { limits, changed } = applySequencesLimit(stale, { gate: true, limit: 25 })

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'sequencesLimit', limit: 25 })
    expect(limits.filter((d) => d.key === 'sequencesLimit')).toHaveLength(1)
  })
})
