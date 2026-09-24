// packages/lib/src/accounting/connect-and-go/__tests__/complete.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError, UnprocessableEntityError } from '../../../errors'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  settings: {} as Record<string, unknown>,
  writes: [] as { key: string; value: string }[][],
  roleWrites: [] as Record<string, unknown>[],
  frozen: false,
  openingPosted: false,
  fillResults: [] as Array<'ok' | 'unmatched' | 'fail'>,
  imported: [] as string[][],
  activationFails: false,
  finalizeStatus: 'posted' as string,
  adjustment: null as { status: string } | null,
  recoveryRequested: 0,
}))

vi.mock('../lock', () => ({
  withSetupLock: async (_db: unknown, _org: string, fn: () => Promise<unknown>) => {
    h.calls.push('lock')
    return fn()
  },
}))
vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => h.settings,
}))
vi.mock('../../../settings/settings-service', () => ({
  batchUpdateOrganizationSettings: async (input: {
    settings: { key: string; value: string }[]
  }) => {
    h.calls.push('settings')
    h.writes.push(input.settings)
  },
}))
vi.mock('../../ledger/periods/settled-periods', () => ({
  assertAccountingSetupUnfrozen: async () => {
    if (h.frozen) throw new ConflictError('accounting.cutoffPeriod cannot change')
  },
}))
vi.mock('../../ledger/roles/role-map', () => ({
  setRoleAssignment: async (_db: unknown, options: Record<string, unknown>) => {
    h.calls.push('role')
    h.roleWrites.push(options)
    return ok({})
  },
}))
vi.mock('../bank-account-writes', () => ({
  applyBankAccountProposals: async (_db: unknown, input: { accept: string[] }) => {
    h.calls.push('banks')
    return ok({
      created: input.accept.map((key) => ({ key, bankAccountId: 'ba_1', glAccountId: 'gl_1' })),
      linked: [],
      skipped: [],
      failed: [],
    })
  },
}))
vi.mock('../activate-book-connection', () => ({
  activateBookConnectionForSetup: async () => {
    h.calls.push('activate')
    if (h.activationFails) return err(new UnprocessableEntityError('No usable company'))
    return ok({ activated: true, connectionId: 'conn_1', exportFromDate: '2026-01-01' })
  },
}))
vi.mock('../../opening/reads', () => ({
  readOpeningPresence: async () => ({
    posted: h.openingPosted,
    summary: { debitMinor: 0, creditMinor: 0, rows: 0 },
  }),
}))
vi.mock('../../opening/fill-from-provider', () => ({
  fillOpeningTrialBalanceFromProvider: async () => {
    h.calls.push('fill')
    const next = h.fillResults.shift() ?? 'ok'
    if (next === 'unmatched')
      return err(
        new UnprocessableEntityError('2 accounts carry a balance', {
          providerAccountIds: ['p_1', 'p_2'],
        })
      )
    if (next === 'fail') return err(new UnprocessableEntityError('Currency mismatch'))
    return ok({ asOf: '2025-12-31', currency: 'USD', filledCount: 12, differenceMinor: 0 })
  },
}))
vi.mock('../../ledger/chart/chart-import', () => ({
  importProviderAccounts: async (_db: unknown, options: { providerAccountIds: string[] }) => {
    h.calls.push('import')
    h.imported.push(options.providerAccountIds)
    return ok({ created: options.providerAccountIds.length })
  },
}))
vi.mock('../../opening/finalize-setup', () => ({
  finalizeAccountingSetup: async () => {
    h.calls.push('finalize')
    return ok({
      finalizedNow: true,
      opening: {
        status: h.finalizeStatus,
        ...(h.finalizeStatus === 'posted' ? {} : { error: 'Period closed' }),
      },
    })
  },
}))
vi.mock('../../../inventory/receiving/opening-inventory-adjustment', () => ({
  postOpeningInventoryAdjustment: async () => {
    h.calls.push('adjust')
    return ok({ difference: { differenceMinor: 500 }, post: h.adjustment })
  },
}))
vi.mock('../../work-items/recovery', () => ({
  requestAccountingRecovery: async () => {
    h.recoveryRequested++
  },
}))

import { completeConnectAndGo } from '../complete'

const db = {} as Database
const base = { organizationId: 'org_1', actorUserId: 'usr_1', cutoffPeriod: '2025-12' }

beforeEach(() => {
  h.calls = []
  h.settings = { 'accounting.cutoffPeriod': null, 'accounting.bookTimeZone': 'America/Chicago' }
  h.writes = []
  h.roleWrites = []
  h.frozen = false
  h.openingPosted = false
  h.fillResults = []
  h.imported = []
  h.activationFails = false
  h.finalizeStatus = 'posted'
  h.adjustment = { status: 'posted' }
  h.recoveryRequested = 0
})

describe('completeConnectAndGo', () => {
  it('refuses a malformed cutover before writing anything', async () => {
    const result = await completeConnectAndGo(db, { ...base, cutoffPeriod: '2025-13' })
    expect(result.isErr()).toBe(true)
    expect(h.calls).toEqual([])
  })

  it('writes the answers, then activates, fills, finalizes and adjusts, in that order', async () => {
    const report = (
      await completeConnectAndGo(db, {
        ...base,
        answers: {
          roles: [{ role: 'revenue_product', glAccountId: 'gl_sales' }],
          railBanks: [{ paymentGatewayId: 'gw_1', glAccountId: 'gl_bank' }],
          acceptBankAccounts: ['create:gl_bank'],
        },
      })
    )._unsafeUnwrap()

    expect(h.calls).toEqual([
      'lock',
      'settings',
      'role',
      'role',
      'banks',
      'activate',
      'fill',
      'finalize',
      'adjust',
    ])
    expect(h.writes[0]).toEqual([{ key: 'accounting.cutoffPeriod', value: '2025-12' }])
    expect(h.roleWrites[1]).toMatchObject({
      role: 'bank',
      paymentGatewayId: 'gw_1',
      glAccountId: 'gl_bank',
    })
    expect(report.completed).toBe(true)
    expect(report.failedAt).toBeNull()
    expect(report.steps.map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
    ])
    expect(h.recoveryRequested).toBe(1)
  })

  it('imports the unmatched provider accounts and fills once more', async () => {
    h.fillResults = ['unmatched', 'ok']
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()

    expect(h.imported).toEqual([['p_1', 'p_2']])
    expect(h.calls.filter((call) => call === 'fill')).toHaveLength(2)
    expect(report.opening).toEqual({ filledCount: 12, differenceMinor: 0, importedAccounts: 2 })
    expect(report.completed).toBe(true)
  })

  it('retries the fill only once', async () => {
    h.fillResults = ['unmatched', 'unmatched']
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()
    expect(h.calls.filter((call) => call === 'fill')).toHaveLength(2)
    expect(report.failedAt).toBe('opening')
    expect(h.calls).not.toContain('finalize')
  })

  it('stops at the first refusal and keeps the steps before it', async () => {
    h.activationFails = true
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()

    expect(report.completed).toBe(false)
    expect(report.failedAt).toBe('book_connection')
    expect(report.message).toBe('No usable company')
    expect(h.calls).toEqual(['lock', 'settings', 'activate'])
    expect(h.recoveryRequested).toBe(0)
  })

  it('treats a refused opening post as a failure', async () => {
    h.finalizeStatus = 'period_closed'
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()
    expect(report.failedAt).toBe('finalize')
    expect(report.message).toBe('Period closed')
    expect(h.calls).not.toContain('adjust')
  })

  it('refuses to move a frozen cutover', async () => {
    h.settings['accounting.cutoffPeriod'] = '2025-11'
    h.frozen = true
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()
    expect(report.failedAt).toBe('cutover')
    expect(h.writes).toEqual([])
  })

  it('needs a timezone when none is set', async () => {
    h.settings['accounting.bookTimeZone'] = null
    const missing = (await completeConnectAndGo(db, base))._unsafeUnwrap()
    expect(missing.failedAt).toBe('cutover')

    h.calls = []
    h.writes = []
    const answered = (
      await completeConnectAndGo(db, { ...base, answers: { bookTimeZone: 'Europe/Berlin' } })
    )._unsafeUnwrap()
    expect(answered.completed).toBe(true)
    expect(h.writes[0]).toContainEqual({ key: 'accounting.bookTimeZone', value: 'Europe/Berlin' })
  })

  it('re-runs on a finished org without rewriting or refilling', async () => {
    h.settings = {
      'accounting.setupState': 'finalized',
      'accounting.cutoffPeriod': '2025-12',
      'accounting.bookTimeZone': 'America/Chicago',
    }
    h.adjustment = null
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()

    expect(h.calls).toEqual(['lock', 'activate', 'finalize', 'adjust'])
    expect(report.steps.find((step) => step.step === 'cutover')?.status).toBe('skipped')
    expect(report.steps.find((step) => step.step === 'opening')?.status).toBe('skipped')
    expect(report.completed).toBe(true)
  })

  it('skips the fill once the opening has posted', async () => {
    h.openingPosted = true
    const report = (await completeConnectAndGo(db, base))._unsafeUnwrap()
    expect(h.calls).not.toContain('fill')
    expect(report.steps.find((step) => step.step === 'opening')?.detail).toBe('Already posted')
  })
})
