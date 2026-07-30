// packages/lib/src/data-migrations/migrations/063-retire-mail-permissions-feature-key.test.ts

import { describe, expect, it } from 'vitest'
import { foldMailPermissions } from './063-retire-mail-permissions-feature-key'

/**
 * Plan v3/03 §7.6 (D9) — `FeatureKey.mailPermissions` is deleted and its value
 * folded into `granularPermissions`, so ONE key gates the whole permission layer.
 *
 * The DB plumbing is deliberately not exercised here (that needs a live Postgres);
 * what matters is the merge rule, because the rule is what decides whether an
 * already-seeded org keeps mail sharing. Getting it wrong in the "off" direction
 * silently removes a paid capability, and the loudest instance is the Demo plan:
 * it was `mailPermissions: true, granularPermissions: false`, i.e. exactly the
 * shape a plain DELETE would break.
 */

/** The shipped `BOOLEAN_GATES` matrix as it stood BEFORE §7.6. */
const BEFORE: Record<string, Array<{ key: string; limit: boolean }>> = {
  demo: [
    { key: 'mailPermissions', limit: true },
    { key: 'granularPermissions', limit: false },
  ],
  free: [
    { key: 'mailPermissions', limit: false },
    { key: 'granularPermissions', limit: false },
  ],
  starter: [
    { key: 'mailPermissions', limit: false },
    { key: 'granularPermissions', limit: false },
  ],
  growth: [
    { key: 'mailPermissions', limit: false },
    { key: 'granularPermissions', limit: true },
  ],
  enterprise: [
    { key: 'mailPermissions', limit: true },
    { key: 'granularPermissions', limit: true },
  ],
}

/** The `granularPermissions` limit the fold leaves behind. */
function granular(limits: Array<{ key: string; limit: unknown }>): unknown {
  return limits.find((l) => l.key === 'granularPermissions')?.limit
}

describe('foldMailPermissions — the merge rule (§7.6)', () => {
  it.each([
    ['demo', true],
    ['free', false],
    ['starter', false],
    ['growth', true],
    ['enterprise', true],
  ])('%s resolves to granularPermissions: %s — Demo + Growth + Enterprise', (plan, expected) => {
    const { limits, changed } = foldMailPermissions(BEFORE[plan])
    expect(changed).toBe(true)
    expect(granular(limits)).toBe(expected)
  })

  it('the retired key is gone from every plan', () => {
    for (const plan of Object.keys(BEFORE)) {
      const { limits } = foldMailPermissions(BEFORE[plan])
      expect(limits.map((l) => l.key)).not.toContain('mailPermissions')
    }
  })

  it('nothing that could share mail before loses it', () => {
    // The one-directional guarantee, stated as its own test: `mailPermissions: on`
    // ⇒ `granularPermissions: on`, whatever the second key said.
    for (const plan of Object.keys(BEFORE)) {
      const had = BEFORE[plan]!.find((l) => l.key === 'mailPermissions')?.limit
      if (!had) continue
      expect(granular(foldMailPermissions(BEFORE[plan]).limits)).toBe(true)
    }
  })

  it('is idempotent — a second pass reports no change and rewrites nothing', () => {
    const first = foldMailPermissions(BEFORE.demo)
    const second = foldMailPermissions(first.limits)
    expect(second.changed).toBe(false)
    expect(second.limits).toEqual(first.limits)
  })

  it('leaves a plan that never carried the key untouched', () => {
    const input = [
      { key: 'granularPermissions', limit: false },
      { key: 'dashboards', limit: true },
    ]
    const { limits, changed } = foldMailPermissions(input)
    expect(changed).toBe(false)
    expect(limits).toEqual(input)
  })

  it('preserves order and every unrelated key', () => {
    const { limits } = foldMailPermissions([
      { key: 'teammates', limit: 5 },
      { key: 'mailPermissions', limit: true },
      { key: 'dashboards', limit: false },
      { key: 'granularPermissions', limit: false },
      { key: 'storageGbHard', limit: 10 },
    ])
    expect(limits).toEqual([
      { key: 'teammates', limit: 5 },
      { key: 'dashboards', limit: false },
      { key: 'granularPermissions', limit: true },
      { key: 'storageGbHard', limit: 10 },
    ])
  })

  it('APPENDS granularPermissions when a hand-edited plan is missing it', () => {
    const { limits } = foldMailPermissions([{ key: 'mailPermissions', limit: true }])
    expect(limits).toEqual([{ key: 'granularPermissions', limit: true }])
  })

  it("reads a limit's truthiness the way `hasAccess` does (`'+'` is on, `0` is off)", () => {
    expect(granular(foldMailPermissions([{ key: 'mailPermissions', limit: '+' }]).limits)).toBe(
      true
    )
    expect(granular(foldMailPermissions([{ key: 'mailPermissions', limit: 0 }]).limits)).toBe(false)
  })

  it('survives a null / garbage featureLimits column', () => {
    for (const input of [null, undefined, {}, 'nonsense']) {
      expect(foldMailPermissions(input)).toEqual({ limits: [], changed: false })
    }
  })
})
