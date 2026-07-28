// apps/web/src/app/api/eval/run/[runId]/events/agent-access.test.ts

import { Area, expandLevelsToKeys, Level, type PermissionKey } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The eval SSE recovery route authenticated with `auth.api.getSession` and
 * scoped the run by organization, but read no capabilities — so any
 * authenticated member could replay any eval run's full trace (agent messages,
 * tool calls, assertion verdicts) while every `eval.*` tRPC procedure sits
 * behind `permissionProcedure(agentsManage)`.
 *
 * Behavioral: the real handler runs, with a REAL `CapabilitySet`. The DB read
 * is the observed side effect — the gate must land ahead of it.
 */

const { getCapabilities, getSession, limit } = vi.hoisted(() => ({
  getCapabilities: vi.fn(),
  getSession: vi.fn(),
  limit: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  },
  schema: { EvalRun: { id: 'id', organizationId: 'organizationId' } },
}))

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn() }))

vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// The barrel hangs under vitest — stub it, keep the enums real via /client.
vi.mock('@auxx/lib/permissions', () => ({ getCapabilities }))

vi.mock('@auxx/redis', () => ({
  RedisEventRouter: {
    getInstance: () => ({ subscribe: vi.fn(async () => 'h1'), unsubscribe: vi.fn() }),
  },
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { GET } = await import('./route')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
const RUN_ID = 'evr_cuid000000000000000000000'

function signedIn(agentsLevel: Level) {
  getSession.mockResolvedValue({ user: { id: USER_ID, defaultOrganizationId: ORG_ID } })
  getCapabilities.mockResolvedValue(
    new CapabilitySet(
      new Set(expandLevelsToKeys({ [Area.agents]: agentsLevel }) as PermissionKey[]),
      {},
      'MEMBER',
      'full'
    )
  )
}

const request = () =>
  ({
    headers: new Headers(),
    nextUrl: new URL(`http://localhost/api/eval/run/${RUN_ID}/events`),
    signal: new AbortController().signal,
  }) as never

const params = { params: Promise.resolve({ runId: RUN_ID }) }

beforeEach(() => {
  getSession.mockReset()
  getCapabilities.mockReset()
  limit
    .mockReset()
    .mockResolvedValue([{ id: RUN_ID, status: 'passed', trace: [], assertionResults: [] }])
})

describe('GET /api/eval/run/[runId]/events', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(request(), params)
    expect(res.status).toBe(401)
    expect(limit).not.toHaveBeenCalled()
  })

  it('403s a member without agents.manage before touching the run', async () => {
    signedIn(Level.None)
    const res = await GET(request(), params)
    expect(res.status).toBe(403)
    // The gate must precede the DB read — otherwise existence is still probeable.
    expect(limit).not.toHaveBeenCalled()
  })

  it('streams the run for a member holding agents.manage', async () => {
    signedIn(Level.Full)
    const res = await GET(request(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(limit).toHaveBeenCalledTimes(1)
    const body = await res.text()
    expect(body).toContain('connected')
  })

  it('404s an unknown run for an authorized member', async () => {
    signedIn(Level.Full)
    limit.mockResolvedValueOnce([])
    const res = await GET(request(), params)
    expect(res.status).toBe(404)
  })
})
