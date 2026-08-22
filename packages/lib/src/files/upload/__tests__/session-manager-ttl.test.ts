// packages/lib/src/files/upload/__tests__/session-manager-ttl.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadPreparedConfig } from '../init-types'
import { SessionManager } from '../session-manager'

/**
 * Map-backed Redis double that enforces the parts of the real ioredis SETEX
 * contract this bug depends on:
 *  - a TTL of 0 or less is an error (`ERR invalid expire time in 'setex' command`)
 *  - keys actually expire, so `get` stops answering once the TTL elapses
 */
const { fakeRedis, getRedisClientMock } = vi.hoisted(() => {
  type Entry = { value: string; expiresAtMs: number }

  const store = new Map<string, Entry>()

  const live = (key: string): Entry | undefined => {
    const entry = store.get(key)
    if (!entry) return undefined
    if (entry.expiresAtMs <= Date.now()) {
      store.delete(key)
      return undefined
    }
    return entry
  }

  const client = {
    reset() {
      store.clear()
    },
    /** Remaining TTL in whole seconds, mirroring Redis `TTL` (-2 = no such key) */
    ttlOf(key: string): number {
      const entry = live(key)
      if (!entry) return -2
      return Math.ceil((entry.expiresAtMs - Date.now()) / 1000)
    },
    setex: vi.fn(async (key: string, ttl: number, value: string) => {
      // ioredis rejects non-positive expiries — this is the failure under test.
      if (!Number.isInteger(ttl) || ttl <= 0) {
        throw new Error("ERR invalid expire time in 'setex' command")
      }
      store.set(key, { value, expiresAtMs: Date.now() + ttl * 1000 })
      return 'OK'
    }),
    get: vi.fn(async (key: string) => live(key)?.value ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  }

  return { fakeRedis: client, getRedisClientMock: vi.fn(async () => client) }
})

vi.mock('@auxx/redis', () => ({
  getRedisClient: getRedisClientMock,
}))

const SESSION_KEY = (id: string) => `upload:session:${id}`

/** Minimal prepared config; only the TTL-relevant fields matter here. */
function makeConfig(ttlSec: number): UploadPreparedConfig {
  return {
    organizationId: 'org123',
    userId: 'user123',
    fileName: 'big-video.mp4',
    mimeType: 'video/mp4',
    expectedSize: 512 * 1024 * 1024,
    entityType: 'FILE',
    provider: 'S3',
    storageKey: 'org123/files/big-video.mp4',
    ttlSec,
    policy: {
      keyPrefix: 'org123/files',
      contentLengthRange: [1, 1024 * 1024 * 1024],
      maxTtl: 3600,
      allowedMimeTypes: ['video/mp4'],
    },
    uploadPlan: { strategy: 'multipart', partSize: 8 * 1024 * 1024 },
    visibility: 'PRIVATE',
    bucket: 'auxx-private',
    metadata: {},
  }
}

const T0 = new Date('2026-08-21T10:00:00.000Z').getTime()

describe('SessionManager TTL handling', () => {
  beforeEach(() => {
    fakeRedis.reset()
    fakeRedis.setex.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('survives a multipart upload that outlives its original expiresAt', async () => {
    // 15-minute session, as a multipart upload would get.
    const session = await SessionManager.createSessionFromConfig(makeConfig(15 * 60))

    // Parts keep arriving for 25 minutes; the parts route touches the session
    // every 5 minutes, so the Redis key never expires.
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(T0 + (i + 1) * 5 * 60 * 1000)
      await SessionManager.touchSession(session.id)
    }

    // The session is still live in Redis 25 minutes in...
    expect(fakeRedis.ttlOf(SESSION_KEY(session.id))).toBeGreaterThan(0)
    expect(await SessionManager.getSession(session.id)).not.toBeNull()

    // ...so `complete` Phase 1 runs. On the buggy code the stored expiresAt is
    // 10 minutes in the past, remainingTtl clamps to 0, and ioredis throws.
    await expect(
      SessionManager.updateSession(session.id, { status: 'processing' })
    ).resolves.toBeUndefined()

    // The key must come out of the update with a usable TTL, not a 1-second
    // sliver that evaporates before the rest of completion runs.
    expect(fakeRedis.ttlOf(SESSION_KEY(session.id))).toBeGreaterThanOrEqual(60)

    const updated = await SessionManager.getSession(session.id)
    expect(updated?.status).toBe('processing')
  })

  it('keeps the stored expiresAt in lockstep with the Redis key TTL on touch', async () => {
    const session = await SessionManager.createSessionFromConfig(makeConfig(15 * 60))

    vi.setSystemTime(T0 + 10 * 60 * 1000)
    await SessionManager.touchSession(session.id)

    const touched = await SessionManager.getSession(session.id)
    const keyTtl = fakeRedis.ttlOf(SESSION_KEY(session.id))
    const storedTtl = Math.round((touched!.expiresAt.getTime() - Date.now()) / 1000)

    expect(touched!.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(storedTtl).toBe(keyTtl)
  })

  it("extends by the session's own ttlSec rather than shrinking to the 10-minute default", async () => {
    // FileProcessor-style one-hour session.
    const session = await SessionManager.createSessionFromConfig(makeConfig(60 * 60))

    vi.setSystemTime(T0 + 5 * 60 * 1000)
    await SessionManager.touchSession(session.id)

    // A touch must never cut a long-lived session down to DEFAULT_TTL (600s).
    expect(fakeRedis.ttlOf(SESSION_KEY(session.id))).toBe(60 * 60)
  })

  it('preserves remaining TTL on a normal in-window update', async () => {
    const session = await SessionManager.createSessionFromConfig(makeConfig(15 * 60))

    vi.setSystemTime(T0 + 5 * 60 * 1000)
    await SessionManager.updateSession(session.id, { status: 'uploading' })

    expect(fakeRedis.ttlOf(SESSION_KEY(session.id))).toBe(10 * 60)
  })
})
