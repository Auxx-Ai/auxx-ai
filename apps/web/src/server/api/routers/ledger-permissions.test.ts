// apps/web/src/server/api/routers/ledger-permissions.test.ts

/**
 * plans/accounting/tasks/done/12-accountant-permissions.md §4.3/§4.4/§7. The third
 * rung on `Area.ledger` (`ledgerControl`) and the period lock's move off the
 * generic settings door.
 *
 * Modelled on `comment-permissions.test.ts`: a real `CapabilitySet` built from
 * `expandLevelsToKeys`, driven through `router.createCaller`, asserting the
 * `ForbiddenError` / `BadRequestError` shape `auxxErrorMiddleware` maps to a
 * status code. Behavioral, not a mock-call count check - deleting an
 * `assert(PermissionKey.ledgerControl)` from the router fails the matching
 * "refuses ledger: Edit" case, because the mocked write would be reached.
 */

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

// ─────────────────────────────────────────────────────────────────────────────
// Doubles - one function per lib call an "admit" case actually reaches. A
// "refuse" case never gets this far: the permission assert throws inside the
// middleware chain, before the resolver body runs.
// ─────────────────────────────────────────────────────────────────────────────

const okResult = <T>(value: T) => ({ isErr: () => false as const, value })

vi.mock('@auxx/lib/accounting/ledger', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/accounting/ledger')
  return {
    ...actual,
    assertAccountingSetupUnfrozen: vi.fn(async () => undefined),
    setLockedThrough: vi.fn(async () => undefined),
    createChartAccount: vi.fn(async () => okResult({ id: 'acc_cuid000000000000000000000' })),
    setRoleAssignment: vi.fn(async () => okResult({ role: 'cash', glAccountId: 'acc_1' })),
    saveRoleAssignments: vi.fn(async () => okResult([{ role: 'cash', glAccountId: 'acc_1' }])),
    // Brief 20 §7.4. The inbound sync RESTATES prior months - it writes into
    // closed periods and reverses entries that have vanished from the provider
    // - so it sits on `ledgerControl` beside `setLockedThrough` rather than on
    // `ledgerPost`. Mocked to a successful enqueue, because the only thing under
    // test here is which rung reaches the resolver body at all.
    enqueueProviderSync: vi.fn(async () => true),
    // 60 E5. Deleting rows out of the firm's books is the `ledgerControl` rung,
    // not the `ledgerPost` one that releases a journal - so this sits beside
    // `setLockedThrough`, not beside `syncExports`. Mocked to a clean tally: the
    // only thing under test is which rung reaches the resolver body.
    unsyncExports: vi.fn(async () =>
      okResult({ withdrawn: 1, refused: 0, failed: 0, outcomes: [] })
    ),
  }
})

vi.mock('@auxx/lib/accounting/journals', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/accounting/journals')
  return {
    ...actual,
    updateJournalEntry: vi.fn(async () => okResult({ id: 'je_1', lines: [] })),
    discardJournalEntry: vi.fn(async () => okResult(undefined)),
  }
})

vi.mock('@auxx/lib/accounting/export', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/accounting/export')
  return {
    ...actual,
    // 93 C2: the bulk Retry is a release with `manual: true`, answered with its run id.
    releaseExportBatches: vi.fn(async () =>
      okResult({ runId: 'run_1', released: ['b1'], skipped: [], blocked: [] })
    ),
    retryExportBatch: vi.fn(async () => okResult({ status: 'sent', attempts: 1 })),
    sendSummaryBucket: vi.fn(async () => okResult({ status: 'sent', attempts: 1, built: true })),
    rebuildSummaryBucket: vi.fn(async () => okResult({ status: 'sent' })),
  }
})

vi.mock('@auxx/lib/seed', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/seed')
  return {
    ...actual,
    // Echoes `packs` back as the walked set rather than actually expanding
    // `requires` - none of the packs this file provisions in a test need a
    // dependency walked in, and `chart-import-plan.test.ts` / the lib-side
    // `gl-account-chart.test.ts` are where `requires` expansion itself is
    // pinned. Brief 16 §1.5.
    seedChartPacks: vi.fn(
      async (_db: unknown, _orgId: string, _defId: string, packs: string[]) => ({
        created: 0,
        skipped: 0,
        rolesAssigned: 0,
        packs,
      })
    ),
    // Task 13 §5.3 / brief 16 §1.5: `provisionChart` seeds the two default
    // payment gateways right after the chart, gated on the walked packs
    // including `card_rail`. Mocked the same way its neighbour above is - the
    // "admit" case only needs `provisionChart` to resolve, not to exercise
    // `seedDefaultPaymentGateways`'s own `GlRoleAssignment` read against a db
    // double this file does not otherwise stub.
    seedDefaultPaymentGateways: vi.fn(async () => ({ created: 0, skipped: 0 })),
  }
})

vi.mock('@auxx/lib/accounting/banking', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/accounting/banking')
  return {
    ...actual,
    createBankAccount: vi.fn(async () => okResult({ id: 'bnk_cuid00000000000000000000' })),
    syncBankAccountFeed: vi.fn(async () => okResult({ status: 'synced' })),
  }
})

vi.mock('@auxx/lib/accounting/providers', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/accounting/providers')
  return {
    ...actual,
    // 97 item 10. Adds accounts to somebody's real books, so it sits on
    // `ledgerControl` beside `createProviderAccount`. Mocked to a clean, empty
    // run: the only thing under test is which rung reaches the resolver body.
    createProviderAccounts: vi.fn(async () =>
      okResult({ created: [], skipped: [], ancestorsAdded: [] })
    ),
  }
})

vi.mock('@auxx/lib/settings', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/settings')
  return {
    ...actual,
    updateOrganizationSetting: vi.fn(async () => undefined),
  }
})

vi.mock('@auxx/lib/cache', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/cache')
  return {
    ...actual,
    getCachedEntityDefId: vi.fn(async () => 'edf_glaccountcuid0000000000'),
    onCacheEvent: vi.fn(async () => undefined),
  }
})

vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  return { PermissionKey, requirePermission: vi.fn(async () => undefined) }
})

vi.mock('~/server/api/audit-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/server/api/audit-context')>()),
  recordAuditFromCtx: vi.fn(async () => undefined),
}))
vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (permission: string) => void } }).capabilities.assert(
          key
        )
        return next()
      }),
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
    isAuxxError: (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in (error as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { ledgerRouter } = await import('./ledger')
const { bankingRouter } = await import('./banking')
const { settingsRouter } = await import('./setting')
const { GL_ACCOUNT_TYPES, ACCOUNT_ROLES } = await import('@auxx/lib/accounting/ledger')
const { BANK_ACCOUNT_TYPES } = await import('@auxx/lib/accounting/banking')
const { seedDefaultPaymentGateways } = await import('@auxx/lib/seed')
const { rebuildSummaryBucket, releaseExportBatches, retryExportBatch, sendSummaryBucket } =
  await import('@auxx/lib/accounting/export')
const { discardJournalEntry, updateJournalEntry } = await import('@auxx/lib/accounting/journals')

type Capabilities = InstanceType<typeof CapabilitySet>

function capabilitiesFor(levels: Partial<Record<Area, Level>>): Capabilities {
  return new CapabilitySet(new Set(expandLevelsToKeys(levels)), {}, 'MEMBER', 'full')
}

const db = { marker: 'ledger-permissions-db' }

const SESSION = {
  organizationId: ORG_ID,
  userId: USER_ID,
  user: { id: USER_ID, defaultOrganizationId: ORG_ID, isAdmin: false },
  isSuperAdmin: false,
}

function ledgerCaller(capabilities: Capabilities) {
  return ledgerRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: SESSION,
  } as never)
}

function bankingCaller(capabilities: Capabilities) {
  return bankingRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: SESSION,
  } as never)
}

function settingCaller(capabilities: Capabilities) {
  return settingsRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: SESSION,
  } as never)
}

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }
const BAD_REQUEST = { cause: { name: 'BadRequestError', statusCode: 400 } }

const ledgerEdit = () => capabilitiesFor({ [Area.ledger]: Level.Edit })
const ledgerFull = () => capabilitiesFor({ [Area.ledger]: Level.Full })
const settingsManageOnly = () => capabilitiesFor({ [Area.settings]: Level.Full })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ledger.setLockedThrough', () => {
  it('refuses a caller with settingsManage but not ledgerControl', async () => {
    await expect(
      ledgerCaller(settingsManageOnly()).setLockedThrough({ periodKey: '2026-08' })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits ledgerControl without settingsManage', async () => {
    await expect(
      ledgerCaller(ledgerFull()).setLockedThrough({ periodKey: '2026-08' })
    ).resolves.toMatchObject({ success: true })
  })
})

describe('ledger.syncProviderLedger', () => {
  // 🛑 Not `ledgerPost`. A bookkeeper holding `ledgerPost` posts what is in
  // front of them; this walks from the cutover forward and decides that last
  // December is now different. Deleting the `ledgerControl` assert from the
  // router makes this case reach the mocked lib call and pass, which is what
  // makes it behavioral rather than a mock-call count.
  it('refuses ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).syncProviderLedger({ to: '2026-01-31' })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits ledger: Full', async () => {
    await expect(
      ledgerCaller(ledgerFull()).syncProviderLedger({ to: '2026-01-31' })
    ).resolves.toMatchObject({ status: 'queued', to: '2026-01-31' })
  })

  it('refuses a caller with settingsManage but not ledgerControl', async () => {
    await expect(
      ledgerCaller(settingsManageOnly()).syncProviderLedger({ to: '2026-01-31' })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('ledger.unsyncExports', () => {
  // 🛑 60 E5 / acceptance 10. `ledger: Edit` carries `ledgerPost` - it may post
  // journals and press Sync - and it must NOT be able to delete the provider's
  // copy of one. Deleting the `ledgerControl` assert makes this case reach the
  // mocked lib call and pass, which is what makes it behavioral.
  it('refuses ledger: Edit, the rung that may post and sync', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).unsyncExports({ glPostingIds: ['gl_1'] })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits ledger: Full', async () => {
    await expect(
      ledgerCaller(ledgerFull()).unsyncExports({ glPostingIds: ['gl_1'] })
    ).resolves.toMatchObject({ withdrawn: 1 })
  })

  // ⚠️ 100, not `syncExports`' 500: this WAITS on the provider and makes two to
  // three round trips per row inside the request (E8).
  it('caps one call at 100 postings', async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `gl_${index}`)
    await expect(ledgerCaller(ledgerFull()).unsyncExports({ glPostingIds: ids })).rejects.toThrow()
    await expect(
      ledgerCaller(ledgerFull()).unsyncExports({ glPostingIds: ids.slice(0, 100) })
    ).resolves.toBeDefined()
  })
})

describe('ledger.createProviderAccounts', () => {
  // 🛑 Same rung as `createProviderAccount`, for a stronger version of its
  // reason: one click adds a whole selection to somebody's real books.
  // Deleting the `ledgerControl` assert makes the Edit case reach the mocked
  // lib call and pass, which is what makes it behavioral.
  it('refuses ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).createProviderAccounts({ glAccountIds: ['gl_1'] })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits ledger: Full', async () => {
    await expect(
      ledgerCaller(ledgerFull()).createProviderAccounts({ glAccountIds: ['gl_1'] })
    ).resolves.toMatchObject({ created: [] })
  })

  it('refuses a caller with settingsManage but not ledgerControl', async () => {
    await expect(
      ledgerCaller(settingsManageOnly()).createProviderAccounts({ glAccountIds: ['gl_1'] })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('ledger chart-structure writes: Edit refused, Full admitted', () => {
  it('chartAccountCreate refuses ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).chartAccountCreate({
        code: '6300',
        name: 'Test expense',
        accountType: GL_ACCOUNT_TYPES[0] as string,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('chartAccountCreate admits ledger: Full', async () => {
    await expect(
      ledgerCaller(ledgerFull()).chartAccountCreate({
        code: '6300',
        name: 'Test expense',
        accountType: GL_ACCOUNT_TYPES[0] as string,
      })
    ).resolves.toBeDefined()
  })

  it('setRoleAssignment refuses ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).setRoleAssignment({
        role: Object.values(ACCOUNT_ROLES as Record<string, string>)[0],
        glAccountId: 'acc_cuid000000000000000000000',
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('setRoleAssignment admits ledger: Full', async () => {
    await expect(
      ledgerCaller(ledgerFull()).setRoleAssignment({
        role: Object.values(ACCOUNT_ROLES as Record<string, string>)[0],
        glAccountId: 'acc_cuid000000000000000000000',
      })
    ).resolves.toBeDefined()
  })

  it('saveMapping refuses ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).saveMapping([
        {
          role: Object.values(ACCOUNT_ROLES as Record<string, string>)[0],
          scope: null,
          value: 'x',
        },
      ])
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('saveMapping admits ledger: Full', async () => {
    await expect(
      ledgerCaller(ledgerFull()).saveMapping([
        {
          role: Object.values(ACCOUNT_ROLES as Record<string, string>)[0],
          scope: null,
          value: 'x',
        },
      ])
    ).resolves.toBeDefined()
  })

  it('provisionChart refuses ledger: Edit', async () => {
    await expect(ledgerCaller(ledgerEdit()).provisionChart()).rejects.toMatchObject(FORBIDDEN)
  })

  it('provisionChart admits ledger: Full', async () => {
    await expect(ledgerCaller(ledgerFull()).provisionChart()).resolves.toBeDefined()
  })

  // Brief 16 §1.5: `seedDefaultPaymentGateways` is gated on the WALKED packs
  // including `card_rail`, never called from the core walk alone. This is a
  // router-level gate (`ledger.ts`'s `provisionChart`), not something
  // `seedChartPacks` itself decides, so it is pinned here rather than in
  // `seed/gl-account-chart-payment-gateways.test.ts`.
  it('never seeds payment gateways after provisioning only core', async () => {
    await ledgerCaller(ledgerFull()).provisionChart({ packs: ['core'] })
    expect(seedDefaultPaymentGateways).not.toHaveBeenCalled()
  })

  it('seeds payment gateways after provisioning card_rail', async () => {
    await ledgerCaller(ledgerFull()).provisionChart({ packs: ['card_rail'] })
    expect(seedDefaultPaymentGateways).toHaveBeenCalledTimes(1)
  })
})

describe('banking rungs', () => {
  it('banking.sync admits ledger: Edit', async () => {
    await expect(
      bankingCaller(ledgerEdit()).sync({ id: 'bnk_cuid00000000000000000000' })
    ).resolves.toBeDefined()
  })

  it('bankAccount.create refuses ledger: Edit', async () => {
    await expect(
      bankingCaller(ledgerEdit()).bankAccount.create({
        name: 'Checking',
        type: BANK_ACCOUNT_TYPES[0] as string,
      })
    ).rejects.toMatchObject(FORBIDDEN)
  })
})

describe('setting.updateOrganizationSetting is not a second door onto the period lock', () => {
  it("refuses 'ledger.lockedThroughMonth' even for a caller holding settingsManage", async () => {
    await expect(
      settingCaller(settingsManageOnly()).updateOrganizationSetting({
        key: 'ledger.lockedThroughMonth',
        value: '2026-08',
      })
    ).rejects.toMatchObject(BAD_REQUEST)
  })
})

describe('ledger.exportBatches.retry', () => {
  it('enqueues a batchIds set as a manual release and answers its runId', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).exportBatches.retry({ batchIds: ['b1', 'b2'] })
    ).resolves.toMatchObject({ runId: 'run_1', released: ['b1'] })
    expect(releaseExportBatches).toHaveBeenCalledWith(db, {
      organizationId: ORG_ID,
      batchIds: ['b1', 'b2'],
      manual: true,
    })
    expect(retryExportBatch).not.toHaveBeenCalled()
  })

  it('keeps one batchId on the synchronous door', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).exportBatches.retry({ batchId: 'b1' })
    ).resolves.toMatchObject({ status: 'sent' })
    expect(retryExportBatch).toHaveBeenCalledWith(db, { organizationId: ORG_ID, batchId: 'b1' })
    expect(releaseExportBatches).not.toHaveBeenCalled()
  })
})

describe('ledger.exportBatches summary buckets', () => {
  const key = {
    avenue: 'receipt',
    grainKey: '2026-09-01',
    storeId: null,
    railId: null,
    currency: 'USD',
  } as const

  it('sendBucket admits ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).exportBatches.sendBucket({ key })
    ).resolves.toMatchObject({ built: true })
    expect(sendSummaryBucket).toHaveBeenCalledWith(db, { organizationId: ORG_ID, key })
  })

  // 95 D3: a rebuild rolls the provider's copy back first, so it sits on `rollback`'s rung.
  it('rebuildBucket refuses ledger: Edit', async () => {
    await expect(
      ledgerCaller(ledgerEdit()).exportBatches.rebuildBucket({ key })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(rebuildSummaryBucket).not.toHaveBeenCalled()
  })

  it('rebuildBucket admits ledger: Full', async () => {
    await ledgerCaller(ledgerFull()).exportBatches.rebuildBucket({ key, force: true })
    expect(rebuildSummaryBucket).toHaveBeenCalledWith(db, {
      organizationId: ORG_ID,
      key,
      force: true,
    })
  })
})

describe('ledger.journalEntry lines and discard (91 D5)', () => {
  const ledgerView = () => capabilitiesFor({ [Area.ledger]: Level.View })

  it('passes line ids through, so the lib keeps, creates and deletes by id', async () => {
    const lines = [
      { id: 'jel_1', glAccountId: 'acc_6300', direction: 'debit' as const, amountMinor: 500 },
      { glAccountId: 'acc_2000', direction: 'credit' as const, amountMinor: 500 },
    ]
    await ledgerCaller(ledgerEdit()).journalEntry.update({ id: 'je_1', lines })
    expect(updateJournalEntry).toHaveBeenCalledWith(db, ORG_ID, USER_ID, {
      journalEntryId: 'je_1',
      lines,
    })
  })

  it('refuses a fractional or negative amount before the lib', async () => {
    for (const amountMinor of [12.5, -1]) {
      await expect(
        ledgerCaller(ledgerEdit()).journalEntry.update({
          id: 'je_1',
          lines: [{ glAccountId: 'acc_6300', direction: 'debit', amountMinor }],
        })
      ).rejects.toThrow()
    }
    expect(updateJournalEntry).not.toHaveBeenCalled()
  })

  it('saves a zero amount - amounts and balance are checked at Post', async () => {
    await ledgerCaller(ledgerEdit()).journalEntry.update({
      id: 'je_1',
      lines: [{ glAccountId: 'acc_6300', direction: 'debit', amountMinor: 0 }],
    })
    expect(updateJournalEntry).toHaveBeenCalled()
  })

  it('discard deletes through the lib and answers with the id', async () => {
    await expect(ledgerCaller(ledgerEdit()).journalEntry.discard({ id: 'je_1' })).resolves.toEqual({
      id: 'je_1',
      discarded: true,
    })
    expect(discardJournalEntry).toHaveBeenCalledWith(db, ORG_ID, USER_ID, {
      journalEntryId: 'je_1',
    })
  })

  it('discard refuses ledger: View', async () => {
    await expect(
      ledgerCaller(ledgerView()).journalEntry.discard({ id: 'je_1' })
    ).rejects.toMatchObject(FORBIDDEN)
    expect(discardJournalEntry).not.toHaveBeenCalled()
  })
})
