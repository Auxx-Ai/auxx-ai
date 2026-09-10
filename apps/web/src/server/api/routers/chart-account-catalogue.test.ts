// apps/web/src/server/api/routers/chart-account-catalogue.test.ts
//
// `ledger.adoptChartAccounts` and `ledger.chartAccountRestore`, driven through a
// real tRPC caller (the `label-channel-authority.test.ts` harness shape).
//
// Two procedures, two different kinds of contract:
//
// - `adoptChartAccounts` owns REAL LOGIC in the router - a catalogue lookup, a
//   refusal that names the offending codes, and a de-duplication whose only
//   observable effect is the `skipped` count the reader is shown. None of it
//   was covered, and all of it is the kind of thing a later refactor quietly
//   changes: a refusal that stops naming codes still refuses, and a lost
//   `new Set` still creates the right accounts.
//
// - `chartAccountRestore` is a thin delegate, so what is worth pinning is the
//   part a delegate can get wrong: that it scopes to the CALLER's org rather
//   than to anything in the input, that it names the caller as the actor, and
//   that an `isErr()` result throws instead of being returned as a value.
//
// Both sit on `ledgerControl` (§ the accountant-permissions build), which the
// harness really enforces rather than stubbing inert - a procedure demoted to a
// weaker rung fails here rather than in production.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEDGER_CONTROL = 'ledger.control'

const hoisted = vi.hoisted(() => {
  const ORG_ID = 'org_cuid000000000000000000000'
  const USER_ID = 'usr_member00000000000000000'
  const ACCOUNT_ID = 'gla_removed0000000000000000'

  const world = {
    /** Capability keys the caller holds. Empty is the interesting case. */
    capabilities: new Set<string>(),
    /** What `getCachedEntityDefId` answers. `undefined` = the def is missing. */
    glAccountDefId: 'def_gl_account' as string | undefined,
    /** Make `restoreChartAccount` fail with this error. */
    restoreError: undefined as Error | undefined,
  }

  /** Capability keys `permissionProcedure` asserted, in order. */
  const gate: string[] = []

  /** The two fields `auxxErrorMiddleware` maps on, hand-rolled above the import graph. */
  const failure = (name: string, statusCode: number, message: string): Error => {
    const error = new Error(message)
    error.name = name
    ;(error as Error & { statusCode: number }).statusCode = statusCode
    return error
  }

  const ok = <T>(value: T) => ({ isOk: () => true, isErr: () => false, value })
  const errResult = (error: Error) => ({ isOk: () => false, isErr: () => true, error })

  const seedChartAccounts = vi.fn(async () => ({ created: 0, skipped: 0, rolesAssigned: 0 }))
  const restoreChartAccount = vi.fn(async () =>
    world.restoreError ? errResult(world.restoreError) : ok({ id: ACCOUNT_ID })
  )

  return {
    ORG_ID,
    USER_ID,
    ACCOUNT_ID,
    world,
    gate,
    failure,
    seedChartAccounts,
    restoreChartAccount,
  }
})

const { ORG_ID, USER_ID, ACCOUNT_ID, world, gate, seedChartAccounts, restoreChartAccount } = hoisted

/**
 * The catalogue, as small as the tests need and shaped like the real one.
 *
 * ⚠️ Stubbed rather than imported, deliberately. A test that read the real
 * `DEFAULT_CHART_OF_ACCOUNTS` would assert on whichever codes that file happens
 * to contain today, so adding an account to the catalogue would break tests
 * about the ROUTER. What is under test is "a code not in the catalogue is
 * refused by name", which needs a catalogue, not this catalogue.
 */
vi.mock('@auxx/lib/postings', () => ({
  DEFAULT_CHART_OF_ACCOUNTS: [
    { code: '1000', name: 'Cash', accountType: 'asset' },
    { code: '1100', name: 'Accounts Receivable', accountType: 'asset' },
    { code: '2000', name: 'Accounts Payable', accountType: 'liability' },
  ],
  restoreChartAccount: hoisted.restoreChartAccount,
  // Everything else the router imports from this module. Present so the import
  // resolves; never called by the two procedures under test.
  ACCOUNT_ROLES: {},
  CHART_PACK_KEYS: [],
  GL_ACCOUNT_SUBTYPES: ['cost_of_goods_sold'],
  GL_ACCOUNT_TYPES: ['asset', 'liability', 'equity', 'revenue', 'expense'],
  POSTING_TYPES: [],
  assertAccountingSetupUnfrozen: vi.fn(),
  buildEntry: vi.fn(),
  confirmSuggestedIdentities: vi.fn(),
  createChartAccount: vi.fn(),
  createJournalEntry: vi.fn(),
  discardJournalEntry: vi.fn(),
  findDuplicateBankMovements: vi.fn(),
  getJournalEntry: vi.fn(),
  getPosting: vi.fn(),
  importChartFromProvider: vi.fn(),
  listAccountIdentities: vi.fn(),
  listChartAccountUsage: vi.fn(),
  listChartAccounts: vi.fn(),
  listClosePeriods: vi.fn(),
  listFailedExports: vi.fn(),
  listJournalEntries: vi.fn(),
  listPostings: vi.fn(),
  listPostingsForSource: vi.fn(),
  listRoleMap: vi.fn(),
  postEntry: vi.fn(),
  postJournalEntry: vi.fn(),
  postMonthEnd: vi.fn(),
  previewEntry: vi.fn(),
  previewJournalEntry: vi.fn(),
  previewMonthEnd: vi.fn(),
  removeChartAccount: vi.fn(),
  resolvePeriodLock: vi.fn(),
  retryExport: vi.fn(),
  reverseEntry: vi.fn(),
  reverseJournalEntry: vi.fn(),
  setAccountIdentity: vi.fn(),
  setRoleAssignment: vi.fn(),
  updateChartAccount: vi.fn(),
  updateJournalEntry: vi.fn(),
  verifyBooksBalance: vi.fn(),
}))

vi.mock('@auxx/lib/seed', () => ({
  seedChartAccounts: hoisted.seedChartAccounts,
  seedChartPacks: vi.fn(),
  seedDefaultPaymentGateways: vi.fn(),
}))

vi.mock('@auxx/lib/cache', () => ({
  getCachedEntityDefId: vi.fn(async () => hoisted.world.glAccountDefId),
  getCachedInstalledApps: vi.fn(async () => []),
  onCacheEvent: vi.fn(),
}))

vi.mock('@auxx/lib/errors', () => ({
  BadRequestError: class extends Error {
    statusCode = 400
    constructor(message: string) {
      super(message)
      this.name = 'BadRequestError'
    }
  },
  UnprocessableEntityError: class extends Error {
    statusCode = 422
    constructor(message: string) {
      super(message)
      this.name = 'UnprocessableEntityError'
    }
  },
}))

vi.mock('@auxx/lib/money', () => ({ getPaymentAccount: vi.fn() }))
vi.mock('@auxx/lib/permissions', () => ({
  PermissionKey: {
    ledgerControl: LEDGER_CONTROL,
    ledgerView: 'ledger.view',
    ledgerPost: 'ledger.post',
  },
}))
vi.mock('@auxx/lib/settings', () => ({ updateOrganizationSetting: vi.fn() }))
vi.mock('~/server/api/audit-context', () => ({ recordAuditFromCtx: vi.fn() }))

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    /**
     * A middleware FACTORY, used as `.use(notDemo('lock a period'))` - not a
     * procedure. Inert here: neither procedure under test is demo-gated, and a
     * demo-org refusal is a different file's subject.
     */
    notDemo:
      () =>
      ({ next }: { next: () => unknown }) =>
        next(),
    /** Really enforces, and records the key, so a demotion fails here. */
    permissionProcedure: (key: string) =>
      t.procedure.use(({ next }) => {
        hoisted.gate.push(key)
        if (!hoisted.world.capabilities.has(key)) {
          throw hoisted.failure('ForbiddenError', 403, `You don't have permission: ${key}`)
        }
        return next()
      }),
  }
})

const { ledgerRouter } = await import('./ledger')

/** `ctx.db` is a sentinel: what matters is that it is FORWARDED, not what it is. */
const db = { __marker: 'ctx.db' }

const invoke = (procedure: string, input?: unknown): Promise<unknown> => {
  const caller = ledgerRouter.createCaller({
    db,
    session: { userId: USER_ID, organizationId: ORG_ID, user: { id: USER_ID } },
  } as never)
  const fn = (caller as unknown as Record<string, (arg?: unknown) => Promise<unknown>>)[procedure]
  if (!fn) throw new Error(`ledger router has no procedure "${procedure}"`)
  return fn(input)
}

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

beforeEach(() => {
  world.capabilities.clear()
  world.glAccountDefId = 'def_gl_account'
  world.restoreError = undefined
  gate.length = 0
  seedChartAccounts.mockClear()
  restoreChartAccount.mockClear()
})

describe('ledger.adoptChartAccounts', () => {
  it('refuses a caller without ledger.control', async () => {
    await expect(invoke('adoptChartAccounts', { codes: ['1000'] })).rejects.toMatchObject(FORBIDDEN)
    expect(gate).toEqual([LEDGER_CONTROL])
    expect(seedChartAccounts).not.toHaveBeenCalled()
  })

  it('refuses an unknown code BY NAME, and seeds nothing', async () => {
    world.capabilities.add(LEDGER_CONTROL)

    // 🛑 The message is the contract, not just the refusal. This is the reader's
    // only clue about which of the codes they sent is wrong, and a rewrite that
    // refuses with "one or more codes are invalid" is strictly worse while still
    // being a refusal.
    await expect(
      invoke('adoptChartAccounts', { codes: ['1000', '9999', '8888'] })
    ).rejects.toMatchObject({ cause: { name: 'BadRequestError', statusCode: 400 } })

    await expect(invoke('adoptChartAccounts', { codes: ['1000', '9999', '8888'] })).rejects.toThrow(
      /9999, 8888/
    )

    // All-or-nothing: one bad code means the whole call is refused, rather than
    // the good ones being adopted and the reader left to notice.
    expect(seedChartAccounts).not.toHaveBeenCalled()
  })

  it('uses the singular when exactly one code is unknown', async () => {
    world.capabilities.add(LEDGER_CONTROL)
    await expect(invoke('adoptChartAccounts', { codes: ['9999'] })).rejects.toThrow(
      /9999 is not an account in the catalogue\./
    )
  })

  it('de-duplicates a repeated code before seeding', async () => {
    world.capabilities.add(LEDGER_CONTROL)

    await invoke('adoptChartAccounts', { codes: ['1000', '1000', '2000'] })

    // 🛑 The duplicate would be filtered to one `missing` row by
    // `seedChartAccounts` anyway, so the accounts created are the same either
    // way. What the `new Set` protects is `skipped`, which is REPORTED: without
    // it the second `1000` comes back as a code the org already held, and the
    // reader is told an account was already there when it was merely named
    // twice.
    const accounts = seedChartAccounts.mock.calls[0]?.[3] as Array<{ code: string }>
    expect(accounts.map((a) => a.code)).toEqual(['1000', '2000'])
  })

  it('forwards the caller org, the def and the catalogue source', async () => {
    world.capabilities.add(LEDGER_CONTROL)

    await invoke('adoptChartAccounts', { codes: ['1100'] })

    const call = seedChartAccounts.mock.calls[0] as unknown[]
    expect(call[0]).toBe(db)
    expect(call[1]).toBe(ORG_ID)
    expect(call[2]).toBe('def_gl_account')
    expect(call[4]).toEqual({ source: 'catalogue' })
  })

  it('resolves the catalogue entry, not just the code', async () => {
    world.capabilities.add(LEDGER_CONTROL)

    await invoke('adoptChartAccounts', { codes: ['2000'] })

    // The router hands `seedChartAccounts` whole catalogue rows. A refactor that
    // passed bare codes would typecheck against a loose signature and seed
    // accounts with no name or type.
    expect(seedChartAccounts.mock.calls[0]?.[3]).toEqual([
      { code: '2000', name: 'Accounts Payable', accountType: 'liability' },
    ])
  })

  it('refuses when the org has no gl_account definition', async () => {
    world.capabilities.add(LEDGER_CONTROL)
    world.glAccountDefId = undefined

    await expect(invoke('adoptChartAccounts', { codes: ['1000'] })).rejects.toMatchObject({
      cause: { name: 'UnprocessableEntityError', statusCode: 422 },
    })
    expect(seedChartAccounts).not.toHaveBeenCalled()
  })

  it('rejects an empty code list before any work', async () => {
    world.capabilities.add(LEDGER_CONTROL)
    // Zod's `.min(1)`, so this never reaches the handler at all.
    await expect(invoke('adoptChartAccounts', { codes: [] })).rejects.toThrow()
    expect(seedChartAccounts).not.toHaveBeenCalled()
  })
})

describe('ledger.chartAccountRestore', () => {
  it('refuses a caller without ledger.control', async () => {
    await expect(invoke('chartAccountRestore', { id: ACCOUNT_ID })).rejects.toMatchObject(FORBIDDEN)
    expect(gate).toEqual([LEDGER_CONTROL])
    expect(restoreChartAccount).not.toHaveBeenCalled()
  })

  it('scopes to the caller org and names the caller as the actor', async () => {
    world.capabilities.add(LEDGER_CONTROL)

    await invoke('chartAccountRestore', { id: ACCOUNT_ID })

    // 🛑 `organizationId` comes from the SESSION and nowhere else. It is the only
    // thing standing between this procedure and un-archiving an account id
    // belonging to another org, and a thin delegate is exactly where that gets
    // dropped.
    expect(restoreChartAccount).toHaveBeenCalledWith(db, {
      organizationId: ORG_ID,
      accountId: ACCOUNT_ID,
      actorUserId: USER_ID,
    })
  })

  it('throws the lib refusal rather than returning it', async () => {
    world.capabilities.add(LEDGER_CONTROL)
    const refusal = Object.assign(new Error('That account is not archived.'), {
      name: 'ConflictError',
      statusCode: 409,
    })
    world.restoreError = refusal

    // An `isErr()` result returned as a value would reach the client as a 200
    // carrying an error object, and the mutation's `onSuccess` would fire.
    await expect(invoke('chartAccountRestore', { id: ACCOUNT_ID })).rejects.toMatchObject({
      cause: { name: 'ConflictError', statusCode: 409 },
    })
  })

  it('rejects a blank id before any work', async () => {
    world.capabilities.add(LEDGER_CONTROL)
    await expect(invoke('chartAccountRestore', { id: '' })).rejects.toThrow()
    expect(restoreChartAccount).not.toHaveBeenCalled()
  })
})
