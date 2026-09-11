// apps/web/src/server/api/routers/ledger-permissions.test.ts

/**
 * plans/accounting/tasks/12-accountant-permissions.md §4.3/§4.4/§7. The third
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

vi.mock('@auxx/lib/postings', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/postings')
  return {
    ...actual,
    assertAccountingSetupUnfrozen: vi.fn(async () => undefined),
    createChartAccount: vi.fn(async () => okResult({ id: 'acc_cuid000000000000000000000' })),
    setRoleAssignment: vi.fn(async () => okResult({ role: 'cash', glAccountId: 'acc_1' })),
    // Brief 20 §7.4. The inbound sync RESTATES prior months - it writes into
    // closed periods and reverses entries that have vanished from the provider
    // - so it sits on `ledgerControl` beside `setLockedThrough` rather than on
    // `ledgerPost`. Mocked to an `ok`, because the only thing under test here
    // is which rung reaches the resolver body at all.
    syncProviderLedger: vi.fn(async () =>
      okResult({
        from: '2026-01-01',
        to: '2026-01-31',
        providerId: 'quickbooks',
        currency: 'USD',
        chunks: [],
        written: 0,
        alreadyPosted: 0,
        reversed: 0,
        deferredToClosedMonths: [],
        refusals: [],
        syncedThrough: '2026-01-31',
      })
    ),
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

vi.mock('@auxx/lib/banking', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/banking')
  return {
    ...actual,
    createBankAccount: vi.fn(async () => okResult({ id: 'bnk_cuid00000000000000000000' })),
    syncBankAccountFeed: vi.fn(async () => okResult({ status: 'synced' })),
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

vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx: vi.fn(async () => undefined) }))
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
const { GL_ACCOUNT_TYPES, ACCOUNT_ROLES } = await import('@auxx/lib/postings')
const { BANK_ACCOUNT_TYPES } = await import('@auxx/lib/banking')
const { seedDefaultPaymentGateways } = await import('@auxx/lib/seed')

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
    ).resolves.toMatchObject({ syncedThrough: '2026-01-31' })
  })

  it('refuses a caller with settingsManage but not ledgerControl', async () => {
    await expect(
      ledgerCaller(settingsManageOnly()).syncProviderLedger({ to: '2026-01-31' })
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
