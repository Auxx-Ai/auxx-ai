// packages/lib/src/data-migrations/migrations/072-mail-filters-limit.test.ts

import { describe, expect, it } from 'vitest'
import { applyMailFiltersLimit } from './072-mail-filters-limit'

/**
 * `mailFiltersLimit` is a NEW static-limit key, so there is nothing in the stored data
 * to derive it from — the migration writes a target matrix. What matters is that it
 * writes the target exactly, APPENDS the key when a hand-edited plan lacks it (an absent
 * key reads as unlimited, which is the fail-open this migration exists to close), and
 * reports `changed: false` on a second pass so the runner does not rewrite every plan
 * row on every deploy.
 *
 * The DB plumbing is deliberately not exercised here (that needs a live Postgres).
 */

/** A plan's stored array as it stood BEFORE this migration (no mail-filter key). */
function before() {
  return [
    { key: 'workflowsLimit', limit: 15 },
    { key: 'sequencesLimit', limit: 3 },
    { key: 'savedViews', limit: 20 },
  ]
}

describe('applyMailFiltersLimit', () => {
  it('appends the limit key when the plan does not carry it', () => {
    const { limits, changed } = applyMailFiltersLimit(before(), 25)

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'mailFiltersLimit', limit: 25 })
  })

  it('replaces a stale limit that drifted from the target', () => {
    const stale = [...before(), { key: 'mailFiltersLimit', limit: 99 }]
    const { limits, changed } = applyMailFiltersLimit(stale, 25)

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'mailFiltersLimit', limit: 25 })
    expect(limits.filter((d) => d.key === 'mailFiltersLimit')).toHaveLength(1)
  })

  it('reports no change when the key already matches the target', () => {
    const current = [...before(), { key: 'mailFiltersLimit', limit: 5 }]
    const { limits, changed } = applyMailFiltersLimit(current, 5)

    expect(changed).toBe(false)
    expect(limits).toEqual(current)
  })

  it('keeps Free at 5 rather than 0 — 0 would read as feature-off', () => {
    const { limits } = applyMailFiltersLimit(before(), 5)

    expect(limits).toContainEqual({ key: 'mailFiltersLimit', limit: 5 })
    expect(limits).not.toContainEqual({ key: 'mailFiltersLimit', limit: 0 })
  })

  it('carries -1 through unchanged for Growth/Enterprise (the features provider maps it to "+")', () => {
    const { limits } = applyMailFiltersLimit(before(), -1)

    expect(limits).toContainEqual({ key: 'mailFiltersLimit', limit: -1 })
  })

  it('preserves every unrelated key and its order', () => {
    const { limits } = applyMailFiltersLimit(before(), 10)

    expect(limits.slice(0, 3).map((d) => d.key)).toEqual([
      'workflowsLimit',
      'sequencesLimit',
      'savedViews',
    ])
    expect(limits).toContainEqual({ key: 'workflowsLimit', limit: 15 })
    expect(limits).toContainEqual({ key: 'savedViews', limit: 20 })
  })

  it('is idempotent — a second pass reports no change', () => {
    const first = applyMailFiltersLimit(before(), 25)
    const second = applyMailFiltersLimit(first.limits, 25)

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.limits).toEqual(first.limits)
  })
})
