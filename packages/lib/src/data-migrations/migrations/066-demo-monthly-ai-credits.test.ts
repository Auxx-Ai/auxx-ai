// packages/lib/src/data-migrations/migrations/066-demo-monthly-ai-credits.test.ts

import { describe, expect, it } from 'vitest'
import { applyDemoCreditLimit } from './066-demo-monthly-ai-credits'

/**
 * What matters is that the Demo plan lands on the target allowance whatever it carried
 * before, that a hand-edited plan missing the key gains it, and that a second pass
 * reports `changed: false` so the runner does not rewrite the row on every deploy.
 *
 * The DB plumbing is deliberately not exercised here (that needs a live Postgres).
 */

const TARGET = 5_000

/** The Demo plan's stored array as it stood BEFORE this migration. */
function before(credits: number) {
  return [
    { key: 'workflowRunsPerMonthHard', limit: 10 },
    { key: 'monthlyAiCredits', limit: credits },
    { key: 'aiCompletionsPerMonthHard', limit: 200 },
  ]
}

describe('applyDemoCreditLimit', () => {
  it('raises the allowance from the old 2,000', () => {
    const { limits, changed } = applyDemoCreditLimit(before(2_000), TARGET)

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'monthlyAiCredits', limit: TARGET })
  })

  it('appends the key when a hand-edited plan does not carry it', () => {
    const { limits, changed } = applyDemoCreditLimit(
      [{ key: 'aiCompletionsPerMonthHard', limit: 200 }],
      TARGET
    )

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'monthlyAiCredits', limit: TARGET })
  })

  it('reports no change on a plan already at the target', () => {
    const { changed } = applyDemoCreditLimit(before(TARGET), TARGET)

    expect(changed).toBe(false)
  })

  it('preserves every unrelated key and its order', () => {
    const { limits } = applyDemoCreditLimit(before(2_000), TARGET)

    expect(limits.map((d) => d.key)).toEqual([
      'workflowRunsPerMonthHard',
      'monthlyAiCredits',
      'aiCompletionsPerMonthHard',
    ])
    expect(limits).toContainEqual({ key: 'workflowRunsPerMonthHard', limit: 10 })
    expect(limits).toContainEqual({ key: 'aiCompletionsPerMonthHard', limit: 200 })
  })

  it('is idempotent — a second pass reports no change', () => {
    const first = applyDemoCreditLimit(before(2_000), TARGET)
    const second = applyDemoCreditLimit(first.limits, TARGET)

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.limits).toEqual(first.limits)
  })

  it('never emits the key twice', () => {
    const { limits } = applyDemoCreditLimit(before(2_000), TARGET)

    expect(limits.filter((d) => d.key === 'monthlyAiCredits')).toHaveLength(1)
  })

  it('lowers the allowance too — the merge is a set, not a raise-only', () => {
    const { limits, changed } = applyDemoCreditLimit(before(20_000), TARGET)

    expect(changed).toBe(true)
    expect(limits).toContainEqual({ key: 'monthlyAiCredits', limit: TARGET })
  })
})
