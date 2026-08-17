// apps/web/src/app/api/pusher/auth/batch/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

/**
 * The batch endpoint's contract (plan v3/05 §2.4). Authorization itself is
 * `RealtimeService.authorizeMany`'s job and is covered in
 * `packages/lib/src/realtime/authorize-many.test.ts`; what is pinned here is
 * the SHAPE, because the shape is what the custom pusher-js authorizer parses:
 *
 * - a denial is `null` inside a 200, never an HTTP error — per-channel verdicts
 *   cannot ride the status when the request carries many channels;
 * - the status describes only whether the REQUEST was well-formed;
 * - a session-less caller gets a full sheet of `null`, not a 401 — the
 *   per-channel route never distinguished "anonymous" from "not yours", and
 *   introducing that distinction here would answer a question the ACL refuses
 *   to answer.
 */

const { getSession, authorizeMany, ensureWebAppInitialized } = vi.hoisted(() => ({
  getSession: vi.fn(),
  authorizeMany: vi.fn(),
  ensureWebAppInitialized: vi.fn(async () => undefined),
}))

vi.mock('@auxx/lib/realtime', () => ({
  getRealtimeService: () => ({ authorizeMany }),
}))

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('~/auth/server', () => ({ auth: { api: { getSession } } }))
vi.mock('~/server/bootstrap', () => ({ ensureWebAppInitialized }))

const ORG = 'abgwpa1l81reht2zmwrcihfu'
const USER = '0D5csE1ejLpyv3rKq3wLQm33dCPNslir'
const SOCKET = '6189518247.123456'
const ALLOWED = `private-org-${ORG}-records-i5aezsg4bc6n8gof2uan3wcf`
const DENIED = `private-org-${ORG}-records-xrbtfl7syi3sm4mqf5wiayuz`

const request = (body: unknown) =>
  ({
    headers: new Headers(),
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token')
      return body
    },
  }) as never

const session = {
  user: { id: USER, defaultOrganizationId: ORG, name: 'Markus', email: 'm@example.com' },
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(session)
  authorizeMany
    .mockReset()
    .mockImplementation(async (_socket: string, channels: string[]) =>
      Object.fromEntries(channels.map((c) => [c, c === ALLOWED ? { auth: 'key:sig' } : null]))
    )
})

describe('POST /api/pusher/auth/batch', () => {
  it('returns 200 with a per-channel verdict for a mixed batch', async () => {
    const res = await POST(request({ socket_id: SOCKET, channels: [ALLOWED, DENIED] }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      results: { [ALLOWED]: { auth: 'key:sig' }, [DENIED]: null },
    })
  })

  it('passes the socket id and the session-derived ctx through to authorizeMany', async () => {
    await POST(request({ socket_id: SOCKET, channels: [ALLOWED] }))

    expect(authorizeMany).toHaveBeenCalledWith(
      SOCKET,
      [ALLOWED],
      { session: { userId: USER, organizationId: ORG } },
      expect.objectContaining({ id: USER })
    )
  })

  it('collapses duplicate channel names before authorizing', async () => {
    const res = await POST(request({ socket_id: SOCKET, channels: [ALLOWED, ALLOWED, DENIED] }))

    expect(authorizeMany.mock.calls[0][1]).toEqual([ALLOWED, DENIED])
    await expect(res.json()).resolves.toEqual({
      results: { [ALLOWED]: { auth: 'key:sig' }, [DENIED]: null },
    })
  })

  it('answers a session-less caller with a full sheet of null, not a 401', async () => {
    getSession.mockResolvedValue(null)
    authorizeMany.mockImplementation(async (_socket: string, channels: string[]) =>
      Object.fromEntries(channels.map((c) => [c, null]))
    )

    const res = await POST(request({ socket_id: SOCKET, channels: [ALLOWED, DENIED] }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ results: { [ALLOWED]: null, [DENIED]: null } })
    expect(authorizeMany).toHaveBeenCalledWith(
      SOCKET,
      [ALLOWED, DENIED],
      { session: null },
      undefined
    )
  })

  it('treats a session with no default organization as anonymous', async () => {
    getSession.mockResolvedValue({ user: { id: USER, defaultOrganizationId: null } })

    await POST(request({ socket_id: SOCKET, channels: [ALLOWED] }))

    expect(authorizeMany.mock.calls[0][2]).toEqual({ session: null })
  })

  it('400s a missing socket_id', async () => {
    const res = await POST(request({ channels: [ALLOWED] }))
    expect(res.status).toBe(400)
    expect(authorizeMany).not.toHaveBeenCalled()
  })

  it('400s a missing or empty channel list', async () => {
    expect((await POST(request({ socket_id: SOCKET }))).status).toBe(400)
    expect((await POST(request({ socket_id: SOCKET, channels: [] }))).status).toBe(400)
    expect((await POST(request({ socket_id: SOCKET, channels: ALLOWED }))).status).toBe(400)
    expect(authorizeMany).not.toHaveBeenCalled()
  })

  it('400s a batch above the cap, without authorizing any of it', async () => {
    const channels = Array.from({ length: 65 }, (_, i) => `private-org-${ORG}-records-def${i}`)

    const res = await POST(request({ socket_id: SOCKET, channels }))

    expect(res.status).toBe(400)
    expect(authorizeMany).not.toHaveBeenCalled()
  })

  it('accepts a batch at the cap', async () => {
    const channels = Array.from({ length: 64 }, (_, i) => `private-org-${ORG}-records-def${i}`)

    const res = await POST(request({ socket_id: SOCKET, channels }))

    expect(res.status).toBe(200)
    expect(authorizeMany.mock.calls[0][1]).toHaveLength(64)
  })

  it('400s an unparseable body', async () => {
    const res = await POST(request('not json'))
    expect(res.status).toBe(400)
    expect(authorizeMany).not.toHaveBeenCalled()
  })

  it('500s when authorization throws, without leaking the reason', async () => {
    authorizeMany.mockRejectedValue(new Error('cache down'))

    const res = await POST(request({ socket_id: SOCKET, channels: [ALLOWED] }))

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error' })
  })
})
