// packages/lib/src/accounting/opening/__tests__/finalize-setup.test.ts
//
// `finalizeAccountingSetup`: the server re-checks readiness, writes the three setup
// keys, THEN posts the opening entry - the one door both Finalize buttons use.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  presence: { posted: false, summary: { debitMinor: 0, creditMinor: 0, rows: 0 } },
  calls: [] as string[],
  batch: vi.fn(),
  postResult: { status: 'posted', glPostingId: 'glp_1' } as Record<string, unknown>,
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings[key] ?? null])),
}))

vi.mock('../../../settings/settings-service', () => ({
  batchUpdateOrganizationSettings: async (input: unknown) => {
    h.calls.push('settings')
    h.batch(input)
  },
}))

vi.mock('../reads', () => ({
  readOpeningPresence: async () => h.presence,
}))

vi.mock('../writes', () => ({
  postOpeningTrialBalance: async () => {
    h.calls.push('post')
    const { ok } = await import('neverthrow')
    return ok(h.postResult)
  },
}))

import { finalizeAccountingSetup } from '../finalize-setup'

const db = {} as never
const input = { organizationId: 'org_1', actorUserId: 'usr_1' }
const BALANCED = { debitMinor: 500_00, creditMinor: 500_00, rows: 2 }

beforeEach(() => {
  h.settings = {
    'accounting.setupState': 'draft',
    'accounting.cutoffPeriod': '2026-12',
    'accounting.bookTimeZone': 'America/New_York',
  }
  h.presence = { posted: false, summary: BALANCED }
  h.calls = []
  h.batch = vi.fn()
  h.postResult = { status: 'posted', glPostingId: 'glp_1' }
})

describe('finalizeAccountingSetup', () => {
  it('writes the three setup keys, then posts the opening entry', async () => {
    const result = (await finalizeAccountingSetup(db, input))._unsafeUnwrap()

    expect(h.calls).toEqual(['settings', 'post'])
    const written = (h.batch.mock.calls[0]![0] as { settings: { key: string; value: unknown }[] })
      .settings
    expect(written.map((s) => s.key)).toEqual([
      'accounting.setupState',
      'accounting.setupFinalizedAt',
      'accounting.setupFinalizedByUserId',
    ])
    expect(written[0]!.value).toBe('finalized')
    expect(written[2]!.value).toBe('usr_1')
    expect(result).toEqual({ finalizedNow: true, opening: h.postResult })
  })

  it('refuses, listing what is unmet, and writes nothing', async () => {
    h.settings['accounting.cutoffPeriod'] = null
    h.presence = { posted: false, summary: { debitMinor: 0, creditMinor: 0, rows: 0 } }

    const error = (await finalizeAccountingSetup(db, input))._unsafeUnwrapErr() as Error & {
      details: Record<string, unknown>
    }
    expect(error.name).toBe('UnprocessableEntityError')
    expect(error.message).toMatch(/No cutoff period set/)
    expect(error.message).toMatch(/No opening balances yet/)
    expect(error.details.unmet).toEqual(['set-accounting-period', 'set-opening-balances'])
    expect(h.calls).toEqual([])
  })

  it('refuses an unbalanced draft', async () => {
    h.presence = { posted: false, summary: { debitMinor: 1, creditMinor: 0, rows: 1 } }
    expect((await finalizeAccountingSetup(db, input)).isErr()).toBe(true)
    expect(h.calls).toEqual([])
  })

  it('finalizes from nothing without posting', async () => {
    h.settings['accounting.openingFromNothing'] = true
    h.presence = { posted: false, summary: { debitMinor: 0, creditMinor: 0, rows: 0 } }

    const result = (await finalizeAccountingSetup(db, input))._unsafeUnwrap()
    expect(h.calls).toEqual(['settings'])
    expect(result.opening).toBeNull()
  })

  it('on an already-finalized org, retries only the post', async () => {
    h.settings['accounting.setupState'] = 'finalized'
    const result = (await finalizeAccountingSetup(db, input))._unsafeUnwrap()
    expect(h.calls).toEqual(['post'])
    expect(result.finalizedNow).toBe(false)
  })

  it('does not post an opening entry that is already posted', async () => {
    h.presence = { posted: true, summary: BALANCED }
    const result = (await finalizeAccountingSetup(db, input))._unsafeUnwrap()
    expect(h.calls).toEqual(['settings'])
    expect(result.opening).toBeNull()
  })

  it('returns a refused post as a status, with setup finalized', async () => {
    h.postResult = { status: 'period_closed', glPostingId: null, error: 'closed' }
    const result = (await finalizeAccountingSetup(db, input))._unsafeUnwrap()
    expect(result.finalizedNow).toBe(true)
    expect(result.opening?.status).toBe('period_closed')
  })
})
