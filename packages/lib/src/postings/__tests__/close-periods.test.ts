// packages/lib/src/postings/__tests__/close-periods.test.ts
//
// The period strip is DERIVED, so every test here is really a test of one
// derivation: which months exist, and which of the three states each is in.
//
// The two derivations worth guarding are the ones a reasonable implementation
// gets wrong. A reversal chain writes a NEW row per revision and flips the
// previous one to `reversed`, so "the newest row" and "the effective row" are
// different questions. And a `pending` claim is an OPEN month with an unfinished
// attempt in it, not a posted one - calling it posted would hide the single
// thing the operator has to act on.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: settings.get,
}))

import { listClosePeriods } from '../close-periods'

const ORG = 'org_1'

/** A stub `Database` that answers any chain with one row set. */
function stubDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'where', 'orderBy', 'innerJoin', 'leftJoin', 'limit']) {
    chain[method] = passthrough
  }
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)

  return { select: () => chain } as unknown as Database
}

/** Wire the three settings this module reads. */
function withSettings(values: Record<string, unknown>) {
  settings.get.mockImplementation(async ({ key }: { key: string }) => values[key] ?? null)
}

function posting(over: Record<string, unknown> = {}) {
  return {
    id: 'gp_1',
    periodKey: '2026-01',
    docNumber: 'JE-0001',
    totalMinor: 125_00,
    postedAt: new Date('2026-02-01T10:00:00.000Z'),
    revision: 0,
    status: 'posted',
    ...over,
  }
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

    const result = await listClosePeriods(stubDb([]), ORG)

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

    const result = await listClosePeriods(stubDb([]), ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('returns an empty strip when the cutoff is the current month', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2026-03',
      'accounting.bookTimeZone': 'America/New_York',
    })

    expect((await listClosePeriods(stubDb([]), ORG))._unsafeUnwrap()).toEqual([])
  })

  it('refuses a cutoff further back than the strip can render, naming the setting', async () => {
    withSettings({
      'accounting.cutoffPeriod': '1926-12',
      'accounting.bookTimeZone': 'America/New_York',
    })

    const result = await listClosePeriods(stubDb([]), ORG)

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

  it('is open with no posting at all', async () => {
    const strip = (await listClosePeriods(stubDb([]), ORG))._unsafeUnwrap()

    expect(strip.every((p) => p.state === 'open')).toBe(true)
    expect(strip[0]?.glPostingId).toBeNull()
    expect(strip[0]?.revision).toBe(0)
  })

  it('is posted, and carries the doc number and total, once the entry reached the books', async () => {
    const strip = (await listClosePeriods(stubDb([posting()]), ORG))._unsafeUnwrap()

    const jan = strip.find((p) => p.periodKey === '2026-01')
    expect(jan?.state).toBe('posted')
    expect(jan?.docNumber).toBe('JE-0001')
    expect(jan?.totalMinor).toBe(125_00)
    expect(jan?.postedAt).toBe('2026-02-01T10:00:00.000Z')
  })

  it('is OPEN, not posted, while a claim is still pending', async () => {
    // A pending claim is an unfinished attempt inside an open month. Reporting
    // it as posted would hide the one thing the operator has to act on, which
    // is exactly what `listUnpostedPeriods` exists to surface.
    const strip = (
      await listClosePeriods(stubDb([posting({ status: 'pending', postedAt: null })]), ORG)
    )._unsafeUnwrap()

    expect(strip.find((p) => p.periodKey === '2026-01')?.state).toBe('open')
  })

  it('is OPEN, not posted, when the last attempt failed', async () => {
    const strip = (
      await listClosePeriods(stubDb([posting({ status: 'failed', postedAt: null })]), ORG)
    )._unsafeUnwrap()

    expect(strip.find((p) => p.periodKey === '2026-01')?.state).toBe('open')
  })

  it('takes the HIGHEST revision as effective, not the first row returned', async () => {
    // A reversal chain leaves more than one live row for a period. Reading the
    // first, or the newest by insertion, would report the superseded entry.
    const rows = [
      posting({ id: 'gp_old', revision: 0, docNumber: 'JE-0001' }),
      posting({ id: 'gp_new', revision: 2, docNumber: 'JE-0003' }),
      posting({ id: 'gp_mid', revision: 1, docNumber: 'JE-0002' }),
    ]

    const strip = (await listClosePeriods(stubDb(rows), ORG))._unsafeUnwrap()

    const jan = strip.find((p) => p.periodKey === '2026-01')
    expect(jan?.glPostingId).toBe('gp_new')
    expect(jan?.revision).toBe(2)
    expect(jan?.docNumber).toBe('JE-0003')
  })

  it('is locked when the month is at or below ledger.lockedThroughMonth', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
      'ledger.lockedThroughMonth': '2026-02',
    })

    const strip = (await listClosePeriods(stubDb([]), ORG))._unsafeUnwrap()

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

    const strip = (await listClosePeriods(stubDb([posting()]), ORG))._unsafeUnwrap()

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

    const result = await listClosePeriods(stubDb([]), ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().every((p) => p.state === 'open')).toBe(true)
  })

  it('treats a cleared lock setting as nothing locked', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
      'ledger.lockedThroughMonth': '   ',
    })

    const strip = (await listClosePeriods(stubDb([]), ORG))._unsafeUnwrap()
    expect(strip.every((p) => p.state === 'open')).toBe(true)
  })
})

describe('failure', () => {
  it('returns an err rather than throwing when a read blows up', async () => {
    withSettings({
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/New_York',
    })
    const db = {
      select: () => {
        throw new Error('connection lost')
      },
    } as unknown as Database

    const result = await listClosePeriods(db, ORG)

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('connection lost')
  })
})
