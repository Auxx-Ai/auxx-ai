// packages/lib/src/postings/__tests__/close-periods.test.ts
//
// The period strip is DERIVED, so every test here is really a test of one
// derivation: which months exist, and whether each is locked.
//
// ⚠️ There is no `posted` state since MIGRATION step 5: a close posts nothing,
// so the strip reads settings only and never touches `GlPosting`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../../settings/read', () => ({
  readOrganizationSettings: settings.get,
}))

import { listClosePeriods } from '../close-periods'

const ORG = 'org_1'

/** Wire the three settings this module reads. */
function withSettings(values: Record<string, unknown>) {
  settings.get.mockImplementation(async (_organizationId: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, values[key] ?? null]))
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // Mid-March 2026, so the strip after a 2025-12 cutoff is Jan, Feb, Mar.
  vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'))
})

describe('the months the strip covers', () => {
  it('starts the month AFTER the cutoff and runs to the current month', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
    })

    const result = await listClosePeriods(ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().map((p) => p.periodKey)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ])
  })

  it('returns an EMPTY strip when setup is unfinished, rather than refusing', async () => {
    // "You have not started" is not a failure. The module home renders the
    // setup checklist, and an error here would make that read as broken.
    withSettings({})

    const result = await listClosePeriods(ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('returns an empty strip when the cutoff is the current month', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2026-03',
      'accounting.bookTimeZone': 'America/New_York',
    })

    expect((await listClosePeriods(ORG))._unsafeUnwrap()).toEqual([])
  })

  it('refuses a cutoff further back than the strip can render, naming the setting', async () => {
    withSettings({
      'accounting.cutoffPeriod': '1926-12',
      'accounting.bookTimeZone': 'America/New_York',
    })

    const result = await listClosePeriods(ORG)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('accounting.cutoffPeriod')
  })
})

describe('each month state', () => {
  beforeEach(() => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
    })
  })

  it('is open until it is locked - a close posts nothing to be posted about', async () => {
    const strip = (await listClosePeriods(ORG))._unsafeUnwrap()

    expect(strip.every((p) => p.state === 'open')).toBe(true)
  })

  it('is locked when the month is at or below ledger.lockedThroughMonth', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
      'ledger.lockedThroughMonth': '2026-02',
    })

    const strip = (await listClosePeriods(ORG))._unsafeUnwrap()

    expect(strip.map((p) => p.state)).toEqual(['locked', 'locked', 'open'])
  })

  it('reads locked ahead of posted, because that is what changes what a reader may do', async () => {
    // A posted month can still be reversed; a locked one cannot be written to
    // at all. Collapsing the two would offer Reverse on a month that refuses it.
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
      'ledger.lockedThroughMonth': '2026-01',
    })

    const strip = (await listClosePeriods(ORG))._unsafeUnwrap()

    expect(strip.find((p) => p.periodKey === '2026-01')?.state).toBe('locked')
  })

  it('ignores a malformed lock rather than refusing to render the console', async () => {
    // Deliberately unlike `resolvePeriodLock`, which fails CLOSED because it
    // guards a write. This only tints a row, and refusing here would hide the
    // settings screen that fixes the value. The write path still fails closed.
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
      'ledger.lockedThroughMonth': 'last december',
    })

    const result = await listClosePeriods(ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().every((p) => p.state === 'open')).toBe(true)
  })

  it('treats a cleared lock setting as nothing locked', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
      'ledger.lockedThroughMonth': '   ',
    })

    const strip = (await listClosePeriods(ORG))._unsafeUnwrap()
    expect(strip.every((p) => p.state === 'open')).toBe(true)
  })
})

describe('failure', () => {
  it('returns an err rather than throwing when a setting cannot be read', async () => {
    // The strip reads nothing but settings now - a close posts nothing, so there
    // is no `GlPosting` row for it to look for.
    withSettings({ 'accounting.cutoffPeriod': 'not-a-month', 'accounting.bookTimeZone': 'UTC' })

    const result = await listClosePeriods(ORG)

    expect(result.isErr()).toBe(true)
  })
})
