// apps/api/src/routes/__tests__/records.test.ts

import { Hono } from 'hono'
import { err, ok } from 'neverthrow'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_USER_ID = 'user_session'
const TOKEN_USER_ID = 'user_token'
const ORG_ID = 'org_1'
const ORG_HANDLE = 'acme'
const INSTALLATION_ID = 'inst_1'

const mockVerifyOrganizationAccess = vi.fn()
const mockVerifyCallbackAuth = vi.fn()
const mockGetCapabilities = vi.fn()
const mockGetRecord = vi.fn()
const mockGetRecords = vi.fn()
const mockHandlerCtor = vi.fn()

// First `import('../organizations')` pulls the real `owned-fields.ts` ->
// `@auxx/lib/cache` graph, which is genuinely slow to transform/evaluate on a
// cold run in this monorepo — a few seconds, not a hang.
vi.setConfig({ testTimeout: 20_000 })

// Mirror the REAL `authMiddleware`'s early-out (apps/api/src/middleware/auth.ts):
// a userId already set by an earlier middleware (the callback-token branch in
// `organizations/index.ts`) is trusted as-is and never overwritten.
vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    if (c.get('userId')) return next()
    c.set('userId', SESSION_USER_ID)
    c.set('user', { id: SESSION_USER_ID, email: 'dev@example.com' })
    await next()
  },
}))

// The real `organizationMiddleware` always re-resolves from the current
// userId + handle, regardless of anything set upstream.
vi.mock('../../middleware/organization', () => ({
  organizationMiddleware: async (c: any, next: any) => {
    c.set('organizationId', ORG_ID)
    c.set('organization', { id: ORG_ID, handle: ORG_HANDLE })
    await next()
  },
}))

vi.mock('../../lib/callback-auth', () => ({
  verifyCallbackAuth: (...args: unknown[]) => mockVerifyCallbackAuth(...args),
}))

vi.mock('@auxx/services/organizations', () => ({
  verifyOrganizationAccess: (...args: unknown[]) => mockVerifyOrganizationAccess(...args),
}))

vi.mock('@auxx/lib/permissions', () => ({
  getCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
}))

vi.mock('@auxx/lib/resources', () => ({
  UnifiedCrudHandler: class {
    constructor(...args: unknown[]) {
      mockHandlerCtor(...args)
    }
    getRecord(...args: unknown[]) {
      return mockGetRecord(...args)
    }
    getRecords(...args: unknown[]) {
      return mockGetRecords(...args)
    }
  },
}))

// `records.ts` pulls in `owned-fields.ts` -> `@auxx/lib/cache`'s dependency
// graph, which reaches real `@auxx/database` schema tables (e.g. `Dataset`)
// even though nothing here ever queries them — a Proxy stands in for every
// table/column so those imports resolve without a real DB.
vi.mock('@auxx/database', () => {
  const column = new Proxy({}, { get: (_t, prop) => String(prop) })
  const schema = new Proxy({}, { get: () => column })
  return { database: {}, schema }
})

// `organizations/index.ts` also mounts `apps`, `bundles` and
// `execute-server-function` — each pulls in its own service-layer graph
// (`@auxx/services/*`, `DemoGuard`, etc.) that this test has no reason to
// load for real. Stub the sibling ROUTE MODULES directly (not their
// transitive deps) so none of that graph is ever imported.
vi.mock('../organizations/apps', () => ({ default: new Hono() }))
vi.mock('../organizations/bundles', () => ({ default: new Hono() }))
vi.mock('../organizations/execute-server-function', () => ({ default: new Hono() }))

// The whole app graph (`organizations/index.ts`) is what's under test now —
// its callback-token middleware sits in front of `records.ts`'s routes.
let organizationsApp: typeof import('../organizations').default
beforeAll(async () => {
  organizationsApp = (await import('../organizations')).default
}, 60_000)

async function getRequest(path: string, headers: Record<string, string> = {}) {
  return organizationsApp.request(path, { method: 'GET', headers })
}

async function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return organizationsApp.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCapabilities.mockResolvedValue({})
})

describe('GET /:handle/records/:recordId — session principal', () => {
  it('404s when the handler cannot see the record — never 403', async () => {
    mockGetRecord.mockResolvedValue(null)

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:hidden`)

    expect(res.status).toBe(404)
    expect(mockHandlerCtor).toHaveBeenCalledWith(ORG_ID, SESSION_USER_ID, {}, undefined, {
      capabilities: {},
    })
  })

  it('returns the projected record on success', async () => {
    mockGetRecord.mockResolvedValue({
      recordId: 'contact:c1',
      entityDefinitionId: 'contact',
      displayName: 'Ann',
      values: { title: { type: 'text', value: 'Hi' } },
      included: {},
      redacted: [],
    })

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      recordId: 'contact:c1',
      displayName: 'Ann',
      values: { title: 'Hi' },
    })
  })

  it('rejects an invalid recordId with 400', async () => {
    const res = await getRequest(`/${ORG_HANDLE}/records/not-a-record-id`)
    expect(res.status).toBe(400)
    expect(mockGetRecord).not.toHaveBeenCalled()
  })

  it('parses fields and include query params', async () => {
    mockGetRecord.mockResolvedValue(null)

    await getRequest(
      `/${ORG_HANDLE}/records/contact:c1?fields=title,status&include=${encodeURIComponent(
        JSON.stringify({ owner: { fields: ['name'] } })
      )}`
    )

    expect(mockGetRecord).toHaveBeenCalledWith('contact:c1', {
      fields: ['title', 'status'],
      include: { owner: { fields: ['name'] } },
    })
  })

  it('rejects malformed include JSON with 400', async () => {
    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1?include=not-json`)
    expect(res.status).toBe(400)
    expect(mockGetRecord).not.toHaveBeenCalled()
  })
})

describe('POST /:handle/records/read — session principal', () => {
  it('caps recordIds at 100 and rejects over it with 400, not a truncation', async () => {
    const recordIds = Array.from({ length: 101 }, (_, i) => `contact:c${i}`)

    const res = await postRequest(`/${ORG_HANDLE}/records/read`, { recordIds })

    expect(res.status).toBe(400)
    expect(mockGetRecords).not.toHaveBeenCalled()
  })

  it('returns {} for an empty recordIds array rather than rejecting it', async () => {
    mockGetRecords.mockResolvedValue({})

    const res = await postRequest(`/${ORG_HANDLE}/records/read`, { recordIds: [] })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('rejects a malformed recordId in the batch', async () => {
    const res = await postRequest(`/${ORG_HANDLE}/records/read`, {
      recordIds: ['contact:c1', 'not-a-record-id'],
    })
    expect(res.status).toBe(400)
    expect(mockGetRecords).not.toHaveBeenCalled()
  })

  it('returns a keyed map of projected records', async () => {
    mockGetRecords.mockResolvedValue({
      'contact:c1': {
        recordId: 'contact:c1',
        entityDefinitionId: 'contact',
        displayName: 'Ann',
        values: {},
        included: {},
        redacted: [],
      },
    })

    const res = await postRequest(`/${ORG_HANDLE}/records/read`, {
      recordIds: ['contact:c1', 'contact:c2'],
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    // c2 is absent from the handler's result (hidden or missing) — absent
    // from the response too, never a null/placeholder entry.
    expect(Object.keys(body)).toEqual(['contact:c1'])
  })
})

describe('records — callback-token principal', () => {
  it('accepts a callback token that carries a userId', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
      userId: TOKEN_USER_ID,
    })
    mockVerifyOrganizationAccess.mockResolvedValue(
      ok({ organization: { id: ORG_ID, handle: ORG_HANDLE }, member: {} })
    )
    mockGetRecord.mockResolvedValue(null)

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1`, {
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer sometoken',
    })

    expect(res.status).toBe(404)
    expect(mockHandlerCtor).toHaveBeenCalledWith(ORG_ID, TOKEN_USER_ID, {}, undefined, {
      capabilities: {},
    })
  })

  it('refuses a callback token with no userId — 401, not a fallback to any org authority', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
      // no userId
    })

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1`, {
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer sometoken',
    })

    expect(res.status).toBe(401)
    expect(mockGetRecord).not.toHaveBeenCalled()
  })

  it('refuses when the token verification itself fails', async () => {
    mockVerifyCallbackAuth.mockReturnValue(null)

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1`, {
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer bad',
    })

    expect(res.status).toBe(401)
    expect(mockGetRecord).not.toHaveBeenCalled()
  })

  it('refuses when the token org does not match the handle-resolved org — replay guard', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: 'org_other',
      userId: TOKEN_USER_ID,
    })
    mockVerifyOrganizationAccess.mockResolvedValue(
      ok({ organization: { id: ORG_ID, handle: ORG_HANDLE }, member: {} })
    )

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1`, {
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer sometoken',
    })

    expect(res.status).toBe(401)
    expect(mockGetRecord).not.toHaveBeenCalled()
  })

  it('refuses when the token user is not a member of the handle-resolved org', async () => {
    mockVerifyCallbackAuth.mockReturnValue({
      installationId: INSTALLATION_ID,
      organizationId: ORG_ID,
      userId: TOKEN_USER_ID,
    })
    mockVerifyOrganizationAccess.mockResolvedValue(
      err({ code: 'ORG_ACCESS_DENIED', message: 'not a member' })
    )

    const res = await getRequest(`/${ORG_HANDLE}/records/contact:c1`, {
      'X-App-Installation-Id': INSTALLATION_ID,
      Authorization: 'Bearer sometoken',
    })

    expect(res.status).toBe(401)
    expect(mockGetRecord).not.toHaveBeenCalled()
  })
})
