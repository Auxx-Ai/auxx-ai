// apps/web/src/app/api/connections/[connectionDefinitionId]/hosted-provision/start/hosted-provision-permission.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * §4.7 of plans/accounting/tasks/12-accountant-permissions.md: `banking.connect` /
 * `reconnect` only ever minted a URL to this route, and this route checked a
 * session and nothing else, so any signed-in member could hit
 * `/api/connections/stripeFinancialConnections/hosted-provision/start` directly
 * and provision a bank feed with no ledger key at all. The route now asserts
 * `ledgerControl` (Area.ledger's Full rung) before it mints a state token or
 * calls into the provider.
 *
 * **AMENDED 2026-09-09 (the Connections permission gate).** That first pass
 * gated the bank feed definition ONLY, leaving `stripeConnect` (Stripe Connect
 * payment onboarding) asserting nothing on this shared route — its whole gate
 * was an `AdminGate` on the payments settings page, so any signed-in member
 * still took the workspace through Connect onboarding by navigating to a URL.
 * It was recorded as a known open item (task 12 §11.6) rather than fixed. It is
 * fixed now: every non-bank-feed hosted-provision definition asserts
 * `integrationsManage`, because hosted provisioning mints a `Credential` and
 * both shipped definitions are `global: true`, i.e. always org-scoped — which
 * is exactly what `Area.integrations`' Full rung governs everywhere else.
 *
 * The two keys are alternatives, NOT a floor plus a bump: the bank feed asserts
 * `ledgerControl` alone, so a controller-shaped profile holding `ledger: Full`
 * and no integrations key keeps the grant task 12 §4.3 designed for it.
 *
 * Behavioral, modelled on `file-download-permission.test.ts`: `requirePermission`
 * is stubbed only as far as its two collaborators (the plan gate and the
 * capability fetch); the registry lookup that decides whether the plan gate
 * runs, and `CapabilitySet.assert` itself, are REAL.
 */

const {
  getSession,
  getCapabilities,
  planGate,
  findConnectionDefinition,
  getRedisClient,
  redisGet,
  redisSetex,
  resolveHostedProvisionHandler,
  getProviderByKey,
  handlerStart,
} = vi.hoisted(() => ({
  getSession: vi.fn(),
  getCapabilities: vi.fn(),
  planGate: vi.fn(),
  findConnectionDefinition: vi.fn(),
  getRedisClient: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  resolveHostedProvisionHandler: vi.fn(),
  getProviderByKey: vi.fn(),
  handlerStart: vi.fn(),
}))

// The `@auxx/lib/permissions` barrel HANGS under vitest, so stub it. The stub is a
// faithful transcription of `capabilities/require.ts`: registry lookup → plan
// gate (only when the key links a `featureKey`) → real `assert`.
vi.mock('@auxx/lib/permissions', async () => {
  const { PERMISSION_REGISTRY_MAP, PermissionKey } = await import(
    '@auxx/lib/permissions/capabilities/registry'
  )
  return {
    PermissionKey,
    requirePermission: async (userId: string, orgId: string, key: never) => {
      const meta = PERMISSION_REGISTRY_MAP.get(key)
      if (meta?.featureKey) await planGate(orgId, meta.featureKey)
      const caps = await getCapabilities(userId, orgId)
      caps.assert(key)
    },
  }
})

// A one-constant stub: the real `@auxx/lib/banking` barrel pulls in the whole
// banking module graph, which this route needs none of beyond the pointer.
vi.mock('@auxx/lib/banking', () => ({ BANK_FEED_PROVIDER_KEY: 'stripeFinancialConnections' }))

vi.mock('@auxx/database', () => ({
  database: { query: { ConnectionDefinition: { findFirst: findConnectionDefinition } } },
}))

vi.mock('@auxx/redis', () => ({
  getRedisClient: async () => getRedisClient(),
}))

vi.mock('@auxx/lib/connections', () => ({ resolveHostedProvisionHandler }))
vi.mock('@auxx/lib/connections/providers', () => ({ getProviderByKey }))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose, the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const BANK_DEF_ID = 'con_cuid00000000000000000bank'
const STRIPE_CONNECT_DEF_ID = 'con_cuid0000000000000stripeconn'

/**
 * A real `CapabilitySet` composing the Ledger area at `level` and, separately,
 * the Integrations area at `integrations` (default `None`). Two axes because the
 * route now picks a different key per definition and the interesting cases are
 * the ones where the member holds one and not the other.
 */
function capabilitiesAt(level: Level, integrations: Level = Level.None) {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.ledger]: level, [Area.integrations]: integrations })),
    {},
    'USER',
    'full'
  )
}

function signedIn(capabilities: InstanceType<typeof CapabilitySet>) {
  getSession.mockResolvedValue({
    user: { id: USER_ID, defaultOrganizationId: ORG_ID, isSuperAdmin: false },
  })
  getCapabilities.mockResolvedValue(capabilities)
}

const bankFeedDef = {
  id: BANK_DEF_ID,
  providerKey: 'stripeFinancialConnections',
  connectionType: 'hosted-provision',
}

const stripeConnectDef = {
  id: STRIPE_CONNECT_DEF_ID,
  providerKey: 'stripeConnect',
  connectionType: 'hosted-provision',
}

// `nextUrl` is what the route reads for `?state=`, `?connectionId=` and `?returnTo=`.
const request = (url: string) => ({ nextUrl: new URL(url) }) as never
const params = (connectionDefinitionId: string) => ({
  params: Promise.resolve({ connectionDefinitionId }),
})

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  planGate.mockReset().mockResolvedValue(undefined)
  findConnectionDefinition.mockReset()
  getRedisClient.mockReset().mockResolvedValue({ get: redisGet, setex: redisSetex })
  redisGet.mockReset()
  redisSetex.mockReset().mockResolvedValue('OK')
  resolveHostedProvisionHandler.mockReset().mockResolvedValue({
    landingPath: '/app/accounting/settings/bank-accounts',
    start: handlerStart,
  })
  getProviderByKey.mockReset().mockReturnValue({ hostedProvisionKey: 'stripeFinancialConnections' })
  handlerStart
    .mockReset()
    .mockResolvedValue({ kind: 'redirect', url: 'https://stripe.example/onboard' })
})

describe('GET .../hosted-provision/start - bank feed provisioning gate', () => {
  it('403s a member composing `ledger: Edit` (ledgerPost, not ledgerControl)', async () => {
    findConnectionDefinition.mockResolvedValue(bankFeedDef)
    signedIn(capabilitiesAt(Level.Edit))

    const res = await GET(
      request('http://localhost/api/connections/stripeFinancialConnections/hosted-provision/start'),
      params('stripeFinancialConnections')
    )

    expect(res.status).toBe(403)
    // No state minted, no provider touched: the gate precedes both.
    expect(redisSetex).not.toHaveBeenCalled()
    expect(handlerStart).not.toHaveBeenCalled()
  })

  it('403s a member with no ledger access at all', async () => {
    findConnectionDefinition.mockResolvedValue(bankFeedDef)
    signedIn(capabilitiesAt(Level.None))

    const res = await GET(
      request('http://localhost/api/connections/stripeFinancialConnections/hosted-provision/start'),
      params('stripeFinancialConnections')
    )

    expect(res.status).toBe(403)
    expect(handlerStart).not.toHaveBeenCalled()
  })

  it('gets past the gate and starts the provider flow for `ledger: Full` (ledgerControl)', async () => {
    findConnectionDefinition.mockResolvedValue(bankFeedDef)
    signedIn(capabilitiesAt(Level.Full))

    const res = await GET(
      request('http://localhost/api/connections/stripeFinancialConnections/hosted-provision/start'),
      params('stripeFinancialConnections')
    )

    expect(res.status).toBe(307) // NextResponse.redirect default
    expect(redisSetex).toHaveBeenCalled()
    expect(handlerStart).toHaveBeenCalled()
  })

  it('403s when the org plan lacks the accounting feature, before any provider call', async () => {
    findConnectionDefinition.mockResolvedValue(bankFeedDef)
    signedIn(capabilitiesAt(Level.Full))
    planGate.mockRejectedValue(
      Object.assign(new Error('Accounting is not available on your plan.'), { statusCode: 403 })
    )

    const res = await GET(
      request('http://localhost/api/connections/stripeFinancialConnections/hosted-provision/start'),
      params('stripeFinancialConnections')
    )

    expect(res.status).toBe(403)
    expect(handlerStart).not.toHaveBeenCalled()
  })

  it('403s the bank feed for `ledger: Full` when the org plan gate runs, not on integrations', async () => {
    // The bank feed asserts `ledgerControl` ALONE. A holder with no integrations
    // access at all must still get through — a controller-shaped profile is
    // exactly the grant task 12 §4.3 designed, and turning the two keys into a
    // floor plus a bump would silently revoke it.
    findConnectionDefinition.mockResolvedValue(bankFeedDef)
    signedIn(capabilitiesAt(Level.Full, Level.None))

    const res = await GET(
      request('http://localhost/api/connections/stripeFinancialConnections/hosted-provision/start'),
      params('stripeFinancialConnections')
    )

    expect(res.status).toBe(307)
    expect(handlerStart).toHaveBeenCalled()
  })
})

describe('GET .../hosted-provision/start - every other definition gates on integrationsManage', () => {
  beforeEach(() => {
    findConnectionDefinition.mockResolvedValue(stripeConnectDef)
    getProviderByKey.mockReturnValue({ hostedProvisionKey: 'stripeConnect' })
  })

  it('403s a member with no integrations access (THE regression this closes)', async () => {
    // Until 2026-09-09 this returned 307 and ran the provider: `stripeConnect`
    // asserted nothing on this shared route, so any signed-in member took the
    // workspace through Stripe Connect onboarding by navigating to a URL.
    signedIn(capabilitiesAt(Level.None, Level.None))

    const res = await GET(
      request('http://localhost/api/connections/stripeConnect/hosted-provision/start'),
      params('stripeConnect')
    )

    expect(res.status).toBe(403)
    // No state minted, no provider touched: the gate precedes both.
    expect(redisSetex).not.toHaveBeenCalled()
    expect(handlerStart).not.toHaveBeenCalled()
  })

  it('403s a member holding only the READ rung (integrations.view, not manage)', async () => {
    // Provisioning is a write. The Read rung added for `connections.list` must
    // not be mistaken for authority to connect anything.
    signedIn(capabilitiesAt(Level.None, Level.Read))

    const res = await GET(
      request('http://localhost/api/connections/stripeConnect/hosted-provision/start'),
      params('stripeConnect')
    )

    expect(res.status).toBe(403)
    expect(handlerStart).not.toHaveBeenCalled()
  })

  it('403s a member holding `ledger: Full` but no integrations key', async () => {
    // The mirror of the bank-feed case above: the two keys are alternatives, so
    // the ledger key buys nothing here.
    signedIn(capabilitiesAt(Level.Full, Level.None))

    const res = await GET(
      request('http://localhost/api/connections/stripeConnect/hosted-provision/start'),
      params('stripeConnect')
    )

    expect(res.status).toBe(403)
    expect(handlerStart).not.toHaveBeenCalled()
  })

  it('lets an `integrationsManage` holder through to the provider', async () => {
    signedIn(capabilitiesAt(Level.None, Level.Full))

    const res = await GET(
      request('http://localhost/api/connections/stripeConnect/hosted-provision/start'),
      params('stripeConnect')
    )

    expect(res.status).toBe(307)
    expect(redisSetex).toHaveBeenCalled()
    expect(handlerStart).toHaveBeenCalled()
  })
})
