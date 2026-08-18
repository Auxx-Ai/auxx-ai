// apps/web/src/app/api/imports/[importJobId]/events/records-import-access.test.ts

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Same class of gap as the eval / workflow-run SSE routes: this handler
 * authenticated with `auth.api.getSession` and scoped the job by organization,
 * but read NO capabilities — so any authenticated member could stream a live
 * import. The forwarded `planning:row` events carry the imported record VALUES
 * (`fields`) plus `existingRecordId`, and the terminal replay carries
 * `statistics`. Its tRPC sibling (`server/api/routers/data-import.ts`) puts
 * every one of its procedures behind `assertImportEntity`.
 *
 * **The gate is def-aware, so the ORDER inverted and so did the status code.**
 * This file used to pin the opposite of what the route now does, because it
 * predates that rework and `web` runs in no CI job that would have said so.
 *
 * `canImportEntity` needs the job's TARGET DEFINITION, which only the
 * `ImportMapping` join yields — so the gate can no longer precede the lookup the
 * way a coarse `requirePermission(recordsImport)` did. Existence is kept
 * unprobeable instead by answering **404 for a denial too**: "no such job in your
 * org" and "not yours to import into" are byte-identical to the caller. The
 * anti-oracle property is now an assertion here rather than a consequence of
 * ordering, and `deniedAndAbsentAreIndistinguishable` is the test that guards it.
 *
 * A 404 also keeps the route free of `AuxxError` -> status mapping: App Router
 * handlers have no `auxxErrorMiddleware`, so the throwing `assertImportEntity`
 * would surface as an unhandled 500. The route reads the boolean predicate.
 *
 * Behavioral: the real handler runs and the gate resolves through a REAL
 * `CapabilitySet`, so allow/deny comes from the shipped registry expansion.
 * `canImportEntity` requires `effectiveRecordLevel >= edit` AND either the
 * `recordsImport` key or `admin` — which is why `Full` streams while `Edit`,
 * who holds recordsView + recordsEdit and nothing more, does not.
 */

const { getCapabilities, getSession, limit } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  limit: vi.fn(),
}))

vi.mock('@auxx/database', async () =>
  (await import('~/test/database-mock')).mockAuxxDatabase({
    database: {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit }) }) }) }),
    },
    schema: {
      ImportJob: {
        id: 'id',
        organizationId: 'organizationId',
        importMappingId: 'importMappingId',
      },
      ImportMapping: { id: 'id', entityDefinitionId: 'entityDefinitionId' },
    },
  })
)

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn() }))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

// The `@auxx/lib/permissions` barrel HANGS under vitest — stub it, keep the
// enums real via `/client` and the predicate real via the deep `capability-set`.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

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
/** The job's target definition, reached only through the `ImportMapping` join. */
const DEF_ID = 'edf_cuid000000000000000000000'

/**
 * Signs a member in at `level` on the `records` area and resolves a REAL
 * `CapabilitySet` for that composition, so allow/deny comes from the shipped
 * registry expansion rather than from the test.
 *
 * Returns the set so a caller can spy on `canImportEntity` and pin WHICH
 * definition the route gates on — the whole point of the mapping join.
 */
function signedIn(level: Level) {
  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })
  const capabilities = new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: level })),
    {},
    'MEMBER',
    'full'
  )
  getCapabilities.mockResolvedValue(capabilities)
  return capabilities
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

/**
 * What the joined select projects: `{ job, entityDefinitionId }`, not a flat job
 * row. The route reads `importJob.job` and `importJob.entityDefinitionId`, so a
 * flat fixture makes the gate read `undefined` and every case throw.
 */
const row = (job: object, entityDefinitionId = DEF_ID) => [{ job, entityDefinitionId }]

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
  getCapabilities.mockReset()
  limit.mockReset().mockResolvedValue(row(runningJob))
})

describe('GET /api/imports/[importJobId]/events — the records-import hole', () => {
  it('401s without a session, before any capability or DB read', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(getCapabilities).not.toHaveBeenCalled()
    expect(limit).not.toHaveBeenCalled()
  })

  it('404s a member composing `records: Edit`', async () => {
    // Edit grants recordsView + recordsEdit but NOT recordsImport — the exact
    // member who used to get the whole stream, row values included.
    signedIn(Level.Edit)
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
  })

  it('404s a member composing `records: None`', async () => {
    signedIn(Level.None)
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
  })

  it('gates on the definition the mapping join yields, not the job id', async () => {
    const capabilities = signedIn(Level.Full)
    const canImport = vi.spyOn(capabilities, 'canImportEntity')
    await readChunks(await GET(request(), params))
    expect(canImport).toHaveBeenCalledWith(DEF_ID)
  })

  it('streams the job for a member holding records.import', async () => {
    signedIn(Level.Full)
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(limit).toHaveBeenCalledTimes(1)
    // The lookup NOW PRECEDES the gate, inverting what this file used to pin:
    // the gate needs the mapping's definition, which only the lookup yields.
    // Existence stays unprobeable via the status code, asserted below.
    expect(limit.mock.invocationCallOrder[0]).toBeLessThan(
      getCapabilities.mock.invocationCallOrder[0]
    )
    expect(await readChunks(res)).toContain('event: connected')
  })

  it('404s an unknown job without reading capabilities at all', async () => {
    signedIn(Level.Full)
    limit.mockResolvedValue([])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('makes denial and absence indistinguishable — the anti-oracle property', async () => {
    // What ordering used to buy, the status code now buys. If either arm ever
    // answers 403, a member without import authority can enumerate which job
    // ids exist in the org by reading the difference.
    signedIn(Level.Edit)
    const denied = await GET(request(), params)

    signedIn(Level.Full)
    limit.mockResolvedValue([])
    const absent = await GET(request(), params)

    expect(denied.status).toBe(absent.status)
    expect(await denied.text()).toBe(await absent.text())
  })

  it('withholds the terminal statistics replay from a member without records.import', async () => {
    // The finished-job branch replays `importJob.statistics` — behind the same gate.
    signedIn(Level.Edit)
    limit.mockResolvedValue(row(completedJob))
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('statistics')
  })

  it('replays the terminal statistics for a member holding records.import', async () => {
    signedIn(Level.Full)
    limit.mockResolvedValue(row(completedJob))
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    const body = await readChunks(res, 2)
    expect(body).toContain('event: job:status')
    expect(body).toContain('statistics')
  })
})
