// packages/lib/src/data-migrations/migrations/065-dashboards-all-plans.test.ts

import { describe, expect, it } from 'vitest'
import { openDashboardsGate } from './065-dashboards-all-plans'

/**
 * The target is a constant (`dashboards: true`) rather than a per-plan matrix, so
 * what matters is that the gate ends up open regardless of what the plan carried,
 * that a hand-edited plan missing the key gains it, and that a second pass reports
 * `changed: false` so the runner does not rewrite every plan row on every deploy.
 *
 * The DB plumbing is deliberately not exercised here (that needs a live Postgres).
 */

/** A plan's stored array as it stood BEFORE this migration. */
function before(gate: boolean) {
  return [
    { key: 'workflowsLimit', limit: 15 },
    { key: 'dashboards', limit: gate },
    { key: 'savedViews', limit: 20 },
  ]
}

describe('openDashboardsGate', () => {
  it('opens the gate on a plan that had dashboards off', () => {
    const { limits, changed } = openDashboardsGate(before(false))

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'dashboards', limit: true })
  })

  it('appends the key when a hand-edited plan does not carry it', () => {
    const { limits, changed } = openDashboardsGate([{ key: 'savedViews', limit: 20 }])

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'dashboards', limit: true })
  })

  it('reports no change on a plan that already had it open', () => {
    const { changed } = openDashboardsGate(before(true))

    expect(changed).toBe(false)
  })

  it('preserves every unrelated key and its order', () => {
    const { limits } = openDashboardsGate(before(false))

    expect(limits.map((d) => d.key)).toEqual(['workflowsLimit', 'dashboards', 'savedViews'])
    expect(limits).toContainEqual({ key: 'workflowsLimit', limit: 15 })
    expect(limits).toContainEqual({ key: 'savedViews', limit: 20 })
  })

  it('is idempotent — a second pass reports no change', () => {
    const first = openDashboardsGate(before(false))
    const second = openDashboardsGate(first.limits)

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.limits).toEqual(first.limits)
  })

  it('never emits the key twice', () => {
    const { limits } = openDashboardsGate(before(false))

    expect(limits.filter((d) => d.key === 'dashboards')).toHaveLength(1)
  })
})
