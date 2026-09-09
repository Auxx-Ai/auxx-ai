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
  }
})

vi.mock('@auxx/lib/seed', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/seed')
  return {
    ...actual,
    seedDefaultChartOfAccounts: vi.fn(async () => ({ created: 0, assigned: 0 })),
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
