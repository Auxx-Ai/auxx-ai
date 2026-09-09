// apps/web/src/server/api/routers/connections-permissions.test.ts

/**
 * The Connections permission gate (2026-09-09).
 *
 * `connections.list` was a bare `protectedProcedure` that handed every member
 * `ownedByOrOrgScoped` — their own connections **plus every org-scoped one** —
 * so any seat, including an outside contractor on a locked-down profile,
 * enumerated the workspace's OAuth connections. `getForEdit` was worse in kind
 * if not in reach: it scoped by org and nothing else, so any credential id in
 * the org returned that row's plain `metadata.connectionVariables`. And `save`,
 * `update`, `delete`, `test` and `refreshTokens` asserted nothing at all.
 *
 * `Area.integrations` gained a `Level.Read` rung (`integrations.view`) to gate
 * the read half; the write half was already `integrationsManage` and simply had
 * no call sites here.
 *
 * 🛑 **The ownership carve-out is the thing these tests exist to protect.** A
 * user-scoped `Credential` belongs to its creator and stays readable and
 * manageable by them at `integrations: None`. Every "own row" case below is a
 * regression guard, not a completeness exercise: gating the read path on
 * `integrationsView` alone would take a member's own connections away from them.
 *
 * Modelled on `calls-tasks-permissions.test.ts` — a real `CapabilitySet` from
 * `expandLevelsToKeys`, driven through `router.createCaller`. `requirePermission`
 * is stubbed only as far as its collaborators: the registry lookup and
 * `CapabilitySet.assert` are REAL.
 */

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const OTHER_USER_ID = 'usr_cuid000000000000000000999'

/** A credential this member owns (`Credential.userId` = them). */
const OWN_CRED = 'cred_own00000000000000000000'
/** A workspace credential (`userId IS NULL`). */
const ORG_CRED = 'cred_org00000000000000000000'
/** Another member's personal credential. */
const OTHER_CRED = 'cred_other000000000000000000'

const okResult = <T>(value: T) => ({
  isErr: () => false as const,
  isOk: () => true as const,
  value,
})

const {
  listCredentials,
  revealSecrets,
  deleteCredential,
  updateCredential,
  mergeSecrets,
  saveConnection,
  runPostConnectHook,
  refreshCredentialTokens,
  isCredentialInUse,
  testCredential,
  testCredentialData,
  isAdminOrOwner,
  orgCacheGet,
  findCredential,
  findConnectionDefinition,
} = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  revealSecrets: vi.fn(),
  deleteCredential: vi.fn(),
  updateCredential: vi.fn(),
  mergeSecrets: vi.fn(),
  saveConnection: vi.fn(),
  runPostConnectHook: vi.fn(),
  refreshCredentialTokens: vi.fn(),
  isCredentialInUse: vi.fn(),
  testCredential: vi.fn(),
  testCredentialData: vi.fn(),
  isAdminOrOwner: vi.fn(),
  orgCacheGet: vi.fn(),
  findCredential: vi.fn(),
  findConnectionDefinition: vi.fn(),
}))

vi.mock('@auxx/credentials/store', () => ({
  listCredentials,
  revealSecrets,
  deleteCredential,
  updateCredential,
  mergeSecrets,
  splitSensitiveFields: (data: Record<string, unknown>) => ({ secrets: {}, metadata: data }),
}))

vi.mock('@auxx/credentials/crypto', () => ({
  isMasked: () => false,
  projectCredentialForEdit: () => ({}),
  splitConnectionValues: () => ({ secretFields: {}, plainVariables: {} }),
}))

vi.mock('@auxx/lib/cache', () => ({ getOrgCache: () => ({ get: orgCacheGet }) }))

vi.mock('@auxx/lib/connections', () => ({
  gateConnectionVariables: (_t: unknown, vars: unknown[]) => vars,
  mintClientCredentialToken: vi.fn(),
  NO_OWN_CLIENT_GATE: { requiresOwnClient: false, ownClientOptional: false, reason: null },
  providerOAuthCallbackUrl: () => 'https://example.test/cb',
  refreshCredentialTokens,
  resolveOwnClientGateForOrg: vi.fn(),
  runPostConnectHook,
  saveConnection,
}))

vi.mock('@auxx/lib/connections/providers', () => ({
  getAllProviders: () => [],
  getProviderByKey: () => undefined,
}))

vi.mock('@auxx/lib/members', () => ({ isAdminOrOwner }))
vi.mock('@auxx/lib/providers', () => ({ getChannelProviderIcon: () => null }))
vi.mock('@auxx/lib/workflow-engine', () => ({
  CredentialTestingService: { testCredential, testCredentialData },
  isCredentialInUse,
}))
vi.mock('@auxx/services/app-connections', () => ({ parseGrantedScopes: () => [] }))

/**
 * The capability set the stubbed `requirePermission` asserts against. Set by
 * `caller()` below — `requirePermission` takes ids, not a context, so the
 * binding has to live here.
 */
let currentCapabilities: { assert: (key: string) => void } | null = null

// The `@auxx/lib/permissions` barrel hangs under vitest, so stub it. The stub is
// a faithful transcription of `capabilities/require.ts`: registry lookup → plan
// gate (only when the key links a `featureKey` — neither integrations key does)
// → the REAL `CapabilitySet.assert`.
vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  return {
    PermissionKey,
    requirePermission: async (_userId: string, _orgId: string, key: string) => {
      currentCapabilities?.assert(key)
    },
  }
})

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    // Attaches the set without asserting — the router branches on it in `list`.
    capabilityProcedure: t.procedure,
    // The demo guard is orthogonal to authorization; a no-op keeps it out of the way.
    notDemo:
      () =>
      ({ ctx, next }: { ctx: unknown; next: (a?: unknown) => unknown }) =>
        next({ ctx }),
    isAuxxError: (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in (error as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { connectionsRouter } = await import('./connections')

type Capabilities = InstanceType<typeof CapabilitySet>

function capabilitiesFor(levels: Partial<Record<Area, Level>>): Capabilities {
  return new CapabilitySet(new Set(expandLevelsToKeys(levels)), {}, 'USER', 'full')
}

const db = {
  query: {
    Credential: { findFirst: findCredential },
    ConnectionDefinition: { findFirst: findConnectionDefinition },
  },
}

function caller(capabilities: Capabilities) {
  currentCapabilities = capabilities
  return connectionsRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: {
      organizationId: ORG_ID,
      userId: USER_ID,
      user: { id: USER_ID, defaultOrganizationId: ORG_ID },
      isSuperAdmin: false,
    },
  } as never)
}

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const noKeys = () => capabilitiesFor({})
const view = () => capabilitiesFor({ [Area.integrations]: Level.Read })
const manage = () => capabilitiesFor({ [Area.integrations]: Level.Full })

beforeEach(() => {
  vi.clearAllMocks()
  listCredentials.mockResolvedValue(okResult([]))
  revealSecrets.mockResolvedValue(okResult({ record: { metadata: {} }, secrets: {} }))
  deleteCredential.mockResolvedValue(okResult(undefined))
  updateCredential.mockResolvedValue(okResult(undefined))
  mergeSecrets.mockResolvedValue(okResult(undefined))
  saveConnection.mockResolvedValue(okResult('cred_new00000000000000000000'))
  runPostConnectHook.mockResolvedValue(undefined)
  refreshCredentialTokens.mockResolvedValue({ success: true })
  isCredentialInUse.mockResolvedValue(false)
  testCredential.mockResolvedValue({ success: true })
  testCredentialData.mockResolvedValue({ success: true })
  isAdminOrOwner.mockResolvedValue(false)
  orgCacheGet.mockResolvedValue([])
  // Each case points this at ONE row with `credentialIs()`. The router builds a
  // Drizzle `where` callback rather than passing the id as a value, so routing
  // by id here would mean interpreting SQL; every case only ever asks for one
  // credential, so the row is set per case instead.
  findCredential.mockResolvedValue(undefined)
  findConnectionDefinition.mockResolvedValue(undefined)
})

/** Point `Credential.findFirst` at one row for the duration of a case. */
function credentialIs(row: { userId: string | null } | undefined) {
  findCredential.mockResolvedValue(row)
}

// ─────────────────────────────────────────────────────────────────────────────
// list — the key selects the SCOPE, never admission
// ─────────────────────────────────────────────────────────────────────────────

describe('connections.list', () => {
  it('confines a caller without integrations.view to rows they OWN', async () => {
    // THE leak. Before the gate this predicate was `ownedByOrOrgScoped`, i.e.
    // own rows PLUS every org-scoped one.
    await caller(noKeys()).list()
    expect(listCredentials).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }))
    expect(listCredentials).not.toHaveBeenCalledWith(
      expect.objectContaining({ ownedByOrOrgScoped: expect.anything() })
    )
  })

  it('gives an integrations.view holder own + org-scoped rows, unchanged', async () => {
    await caller(view()).list()
    expect(listCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ ownedByOrOrgScoped: USER_ID })
    )
  })

  it('does not throw for a caller with no keys — the carve-out forbids a flat 403', async () => {
    // A member's own connections are theirs. If this ever becomes a
    // `permissionProcedure(integrationsView)` the carve-out is gone.
    await expect(caller(noKeys()).list()).resolves.toEqual([])
  })

  it('returns the empty list for an orgScopedOnly request without the key', async () => {
    // `orgScopedOnly` asks for `userId IS NULL`; "rows you own" and "rows nobody
    // owns" are disjoint, so the answer is empty and the query is skipped.
    await expect(caller(noKeys()).list({ orgScopedOnly: true })).resolves.toEqual([])
    expect(listCredentials).not.toHaveBeenCalled()
  })

  it('serves an orgScopedOnly request for an integrations.view holder', async () => {
    await caller(view()).list({ orgScopedOnly: true })
    expect(listCredentials).toHaveBeenCalledWith(expect.objectContaining({ userId: null }))
  })

  it('still shows an admin every row in the org', async () => {
    isAdminOrOwner.mockResolvedValue(true)
    await caller(manage()).list()
    const arg = listCredentials.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.userId).toBeUndefined()
    expect(arg.ownedByOrOrgScoped).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getForEdit — plain connection variables, previously org-scoped and nothing else
// ─────────────────────────────────────────────────────────────────────────────

describe('connections.getForEdit', () => {
  it('refuses a workspace connection to a caller with no integrations keys', async () => {
    credentialIs({ userId: null })
    await expect(caller(noKeys()).getForEdit({ connectionId: ORG_CRED })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it("refuses another member's personal connection", async () => {
    // The sharper half of the old hole: any id in the org returned that row's
    // plain connection variables, personal rows included.
    credentialIs({ userId: OTHER_USER_ID })
    await expect(caller(noKeys()).getForEdit({ connectionId: OTHER_CRED })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('admits the OWNER of a personal connection with no integrations keys (carve-out)', async () => {
    credentialIs({ userId: USER_ID })
    await expect(caller(noKeys()).getForEdit({ connectionId: OWN_CRED })).resolves.toBeDefined()
  })

  it('admits an integrations.view holder on a workspace connection', async () => {
    credentialIs({ userId: null })
    await expect(caller(view()).getForEdit({ connectionId: ORG_CRED })).resolves.toBeDefined()
  })

  it('404s an id that is not in this org, without consulting a key', async () => {
    credentialIs(undefined)
    await expect(caller(manage()).getForEdit({ connectionId: ORG_CRED })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The write half — org-scoped lifecycle is integrationsManage everywhere
// ─────────────────────────────────────────────────────────────────────────────

describe.each([
  ['update', (c: ReturnType<typeof caller>, id: string) => c.update({ id, name: 'x' })],
  ['delete', (c: ReturnType<typeof caller>, id: string) => c.delete({ id })],
  [
    'refreshTokens',
    (c: ReturnType<typeof caller>, id: string) => c.refreshTokens({ credentialId: id }),
  ],
] as const)('connections.%s', (_name, call) => {
  it('refuses a workspace connection to a caller with no keys', async () => {
    credentialIs({ userId: null })
    await expect(call(caller(noKeys()), ORG_CRED)).rejects.toMatchObject(FORBIDDEN)
  })

  it('refuses a workspace connection to an integrations.view holder — read is not write', async () => {
    credentialIs({ userId: null })
    await expect(call(caller(view()), ORG_CRED)).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits an integrations.manage holder on a workspace connection', async () => {
    credentialIs({ userId: null })
    await expect(call(caller(manage()), ORG_CRED)).resolves.toBeDefined()
  })

  it('admits the OWNER of a personal connection with no keys (carve-out)', async () => {
    credentialIs({ userId: USER_ID })
    await expect(call(caller(noKeys()), OWN_CRED)).resolves.toBeDefined()
  })

  it("refuses another member's personal connection", async () => {
    credentialIs({ userId: OTHER_USER_ID })
    await expect(call(caller(view()), OTHER_CRED)).rejects.toMatchObject(FORBIDDEN)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// save — scope follows the DEFINITION's `global` flag, as in the OAuth route
// ─────────────────────────────────────────────────────────────────────────────

describe('connections.save', () => {
  const input = { connectionDefinitionId: 'cdef_1', name: 'Prod key', secret: 's3cret' }

  it('refuses a GLOBAL (org-scoped) definition to a caller with no keys', async () => {
    findConnectionDefinition.mockResolvedValue({
      id: 'cdef_1',
      providerKey: 'openaiApi',
      global: true,
      connectionVariables: [],
      connectionType: 'secret',
    })
    await expect(caller(noKeys()).save(input)).rejects.toMatchObject(FORBIDDEN)
    expect(saveConnection).not.toHaveBeenCalled()
  })

  it('refuses a global definition to an integrations.view holder', async () => {
    findConnectionDefinition.mockResolvedValue({
      id: 'cdef_1',
      providerKey: 'openaiApi',
      global: true,
      connectionVariables: [],
      connectionType: 'secret',
    })
    await expect(caller(view()).save(input)).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits an integrations.manage holder on a global definition', async () => {
    findConnectionDefinition.mockResolvedValue({
      id: 'cdef_1',
      providerKey: 'openaiApi',
      global: true,
      connectionVariables: [],
      connectionType: 'secret',
    })
    await expect(caller(manage()).save(input)).resolves.toEqual({
      credentialId: 'cred_new00000000000000000000',
    })
  })

  it('admits a NON-global definition with no keys — the row will be the caller own', async () => {
    // Scope follows `global`, exactly as `api/apps/[slug]/oauth2/authorize`
    // decides it. A user-scoped credential needs no integrations key.
    findConnectionDefinition.mockResolvedValue({
      id: 'cdef_1',
      providerKey: 'openaiApi',
      global: false,
      connectionVariables: [],
      connectionType: 'secret',
    })
    await expect(caller(noKeys()).save(input)).resolves.toBeDefined()
  })

  it('gates a RECONNECT on the target row, not the definition', async () => {
    // Rotating an existing workspace credential is a workspace act even if the
    // definition were not global — the row's own `userId` is the authority.
    findConnectionDefinition.mockResolvedValue({
      id: 'cdef_1',
      providerKey: 'openaiApi',
      global: false,
      connectionVariables: [],
      connectionType: 'secret',
    })
    credentialIs({ userId: null })
    await expect(caller(noKeys()).save({ ...input, connectionId: ORG_CRED })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('admits a reconnect of the caller OWN row with no keys (carve-out)', async () => {
    findConnectionDefinition.mockResolvedValue({
      id: 'cdef_1',
      providerKey: 'openaiApi',
      global: false,
      connectionVariables: [],
      connectionType: 'secret',
    })
    credentialIs({ userId: USER_ID })
    await expect(caller(noKeys()).save({ ...input, connectionId: OWN_CRED })).resolves.toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// test — view, and the assert must sit OUTSIDE the router's own try/catch
// ─────────────────────────────────────────────────────────────────────────────

describe('connections.test', () => {
  it('refuses a workspace connection to a caller with no keys', async () => {
    credentialIs({ userId: null })
    await expect(caller(noKeys()).test({ credentialId: ORG_CRED })).rejects.toMatchObject(FORBIDDEN)
    expect(testCredential).not.toHaveBeenCalled()
  })

  it('keeps the refusal a refusal — the assert precedes the TRPCError-only catch', async () => {
    // The router's `catch` rethrows only `TRPCError`, so an `AuxxError` raised
    // INSIDE that block would be swallowed and re-thrown as the generic
    // "Failed to test connection", losing the 403 that `errorFormatter` maps
    // from the cause. Move the assert into the `try` and this is what breaks.
    credentialIs({ userId: null })
    const error = await caller(noKeys())
      .test({ credentialId: ORG_CRED })
      .catch((e: { message?: string; cause?: { name?: string; statusCode?: number } }) => e)
    expect(error.cause?.name).toBe('ForbiddenError')
    expect(error.cause?.statusCode).toBe(403)
    expect(error.message).not.toBe('Failed to test connection')
  })

  it('admits an integrations.view holder — testing spends the secret but changes nothing', async () => {
    credentialIs({ userId: null })
    await expect(caller(view()).test({ credentialId: ORG_CRED })).resolves.toBeDefined()
  })

  it('admits the OWNER with no keys (carve-out)', async () => {
    credentialIs({ userId: USER_ID })
    await expect(caller(noKeys()).test({ credentialId: OWN_CRED })).resolves.toBeDefined()
  })

  it('leaves the prospective-values form ungated — no stored credential is read', async () => {
    await expect(
      caller(noKeys()).test({ type: 'openaiApi', data: { apiKey: 'k' } })
    ).resolves.toBeDefined()
    expect(findCredential).not.toHaveBeenCalled()
  })
})
