// apps/web/src/app/api/imports/[importJobId]/events/records-import-access.test.ts

import { Area, expandLevelsToKeys, Level, PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Same class of gap as the eval / workflow-run SSE routes: this handler
 * authenticated with `auth.api.getSession` and scoped the job by organization,
 * but read NO capabilities — so any authenticated member could stream a live
 * import. The forwarded `planning:row` events carry the imported record VALUES
 * (`fields`) plus `existingRecordId`, and the terminal replay carries
 * `statistics`. Its tRPC sibling (`server/api/routers/data-import.ts`) puts
 * every one of its procedures behind `permissionProcedure(recordsImport)`.
 *
 * Behavioral: the real handler runs, and the gate resolves through a REAL
 * `CapabilitySet` built from `expandLevelsToKeys`. The job lookup is the
 * observed side effect — the gate must land ahead of it.
 */

const { requirePermission, getSession, limit } = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getSession: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  },
  schema: { ImportJob: { id: 'id', organizationId: 'organizationId' } },
}))

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn() }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// The `@auxx/lib/permissions` barrel HANGS under vitest — stub it, keep the
// enums real via `/client` and the assert real via the deep `capability-set`.
vi.mock('@auxx/lib/permissions', () => ({ requirePermission }))

vi.mock('@auxx/redis', () => ({
  createDedicatedClient: vi.fn(async () => ({
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    quit: vi.fn(async () => undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  })),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const JOB_ID = 'imj_cuid000000000000000000000'

/**
 * Signs a member in at `level` on the `records` area and wires the stubbed
 * `requirePermission` to the REAL `CapabilitySet.assert` for that composition —
 * so allow/deny comes from the shipped registry expansion, not from the test.
 * (`recordsImport` carries no `featureKey`, so the real `requirePermission`
 * reduces to exactly this assert; there is no plan gate to model.)
 */
function signedIn(level: Level) {
  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })
  const capabilities = new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: level })),
    {},
    'MEMBER',
    'full'
  )
  requirePermission.mockImplementation(async (_userId, _orgId, key: PermissionKey) =>
    capabilities.assert(key)
  )
}

const request = () =>
  ({
    headers: new Headers(),
    signal: new AbortController().signal,
  }) as never

const params = { params: Promise.resolve({ importJobId: JOB_ID }) }

const runningJob = {
  id: JOB_ID,
  organizationId: ORG_ID,
  status: 'processing',
  rowCount: 42,
  columnCount: 7,
  receivedChunks: 1,
  totalChunks: 3,
  allowPlanGeneration: false,
  statistics: null,
  completedAt: null,
}

const completedJob = {
  ...runningJob,
  status: 'completed',
  statistics: { created: 40, updated: 2, skipped: 0 },
  completedAt: new Date('2026-07-27T00:00:00.000Z'),
}

/** Reads `count` SSE chunks, then cancels so no heartbeat interval leaks. */
async function readChunks(res: Response, count = 1) {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const decoder = new TextDecoder()
  let out = ''
  for (let i = 0; i < count; i++) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  await reader.cancel()
  return out
}

beforeEach(() => {
  getSession.mockReset()
  requirePermission.mockReset()
  limit.mockReset().mockResolvedValue([runningJob])
})

describe('GET /api/imports/[importJobId]/events — the records-import hole', () => {
  it('401s without a session, before any capability or DB read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(requirePermission).not.toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
  })

  it('403s a member composing `records: Edit` before touching the job', async () => {
    // Edit grants recordsView + recordsEdit but NOT recordsImport — the exact
    // member who used to get the whole stream, row values included.
    signedIn(Level.Edit)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // The gate must precede the lookup — otherwise job existence is probeable.
    expect(limit).not.toHaveBeenCalled()
  })

  it('403s a member composing `records: None`', async () => {
    signedIn(Level.None)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(limit).not.toHaveBeenCalled()
  })

  it('asserts `records.import` specifically', async () => {
    signedIn(Level.Full)
    await readChunks(await GET(request(), params))
    expect(requirePermission).toHaveBeenCalledWith(USER_ID, ORG_ID, PermissionKey.recordsImport)
  })

  it('streams the job for a member holding records.import, gate first', async () => {
    signedIn(Level.Full)
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(limit).toHaveBeenCalledTimes(1)
    // Ordering pinned on the ALLOWED path too: moving the gate below the lookup
    // still 403s the unauthorized caller, but leaks existence timing.
    expect(requirePermission.mock.invocationCallOrder[0]).toBeLessThan(
      limit.mock.invocationCallOrder[0]
    )
    expect(await readChunks(res)).toContain('event: connected')
  })

  it('404s an unknown job for an authorized member', async () => {
    signedIn(Level.Full)
    limit.mockResolvedValue([])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
  })

  it('withholds the terminal statistics replay from a member without records.import', async () => {
    // The finished-job branch replays `importJob.statistics` — behind the same gate.
    signedIn(Level.Edit)
    limit.mockResolvedValue([completedJob])
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('statistics')
    expect(limit).not.toHaveBeenCalled()
  })

  it('replays the terminal statistics for a member holding records.import', async () => {
    signedIn(Level.Full)
    limit.mockResolvedValue([completedJob])
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    const body = await readChunks(res, 2)
    expect(body).toContain('event: job:status')
    expect(body).toContain('statistics')
  })
})
