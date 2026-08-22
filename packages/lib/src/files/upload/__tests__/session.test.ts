// packages/lib/src/files/upload/__tests__/session.test.ts

/**
 * Upload session lifecycle, with **zero `vi.mock` calls**.
 *
 * This file is the point of PR 4b. `session-manager-ttl.test.ts`, which it
 * replaces, needed a hoisted `vi.mock('@auxx/redis')` and process-global fake
 * timers to say anything at all about a TTL — because `SessionManager` resolved
 * its own client and read its own clock. Both are parameters now, so every case
 * below is plain objects in, assertions out.
 *
 * The four TTL cases carried over from that file are the Tier-1 §1.6 regression
 * guard; the compare-and-set cases are new in this PR.
 */

import { describe, expect, it } from 'vitest'
import { ConflictError, NotFoundError } from '../../../errors'
import { makeClock, makeRedis } from '../../__tests__/support'
import type { UploadPreparedConfig } from '../init-types'
import {
  createUploadSession,
  deleteUploadSession,
  getUploadSession,
  patchUploadSession,
  touchUploadSession,
} from '../session'

const T0 = '2026-08-21T10:00:00.000Z'
const MINUTE = 60_000

const sessionKey = (id: string) => `upload:session:${id}`

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

/** A clock and a Redis double that expires keys against it. */
function harness() {
  const clock = makeClock(T0)
  const fake = makeRedis({ now: clock.now })
  return { clock, fake, redis: fake.redis }
}

describe('upload session lifecycle', () => {
  it('creates, reads, patches and deletes through a Map-backed double', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)
    expect(session.status).toBe('created')
    expect(session.isMultipart).toBe(true)
    expect(session.createdAt).toEqual(new Date(T0))
    expect(session.expiresAt).toEqual(new Date(clock.millis() + 15 * MINUTE))

    const read = await getUploadSession(redis, session.id)
    expect(read?.id).toBe(session.id)
    // Revived, not left as ISO strings — callers do date arithmetic on both.
    expect(read?.createdAt).toBeInstanceOf(Date)
    expect(read?.expiresAt).toBeInstanceOf(Date)

    await patchUploadSession(redis, session.id, { status: 'processing' }, clock.now)
    expect((await getUploadSession(redis, session.id))?.status).toBe('processing')

    await deleteUploadSession(redis, session.id)
    expect(await getUploadSession(redis, session.id)).toBeNull()
    expect(fake.keys()).toEqual([])
  })

  it('returns null for a session Redis no longer holds', async () => {
    const { redis } = harness()
    expect(await getUploadSession(redis, 'nonexistent-session')).toBeNull()
  })

  it('lets a key expire on the injected clock, with no fake timers', async () => {
    const { clock, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(10 * 60), clock.now)
    clock.advance(10 * MINUTE + 1)

    expect(await getUploadSession(redis, session.id)).toBeNull()
  })

  it('refuses a config whose ttlSec is non-positive instead of letting SETEX fail', async () => {
    const { clock, redis } = harness()

    await expect(createUploadSession(redis, makeConfig(0), clock.now)).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})

describe('upload session TTL handling', () => {
  it('survives a multipart upload that outlives its original expiresAt', async () => {
    const { clock, fake, redis } = harness()

    // 15-minute session, as a multipart upload would get.
    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)

    // Parts keep arriving for 25 minutes; the parts route touches the session
    // every 5 minutes, so the Redis key never expires.
    for (let i = 0; i < 5; i++) {
      clock.advance(5 * MINUTE)
      await touchUploadSession(redis, session.id, clock.now)
    }

    // The session is still live in Redis 25 minutes in...
    expect(fake.pttlOf(sessionKey(session.id))).toBeGreaterThan(0)
    expect(await getUploadSession(redis, session.id)).not.toBeNull()

    // ...so `complete` Phase 1 runs. On the buggy code the stored expiresAt is
    // 10 minutes in the past, the remaining TTL clamps to 0, and ioredis throws.
    await expect(
      patchUploadSession(redis, session.id, { status: 'processing' }, clock.now)
    ).resolves.toBeUndefined()

    // The key must come out of the patch with a usable TTL, not a 1-second
    // sliver that evaporates before the rest of completion runs.
    expect(fake.pttlOf(sessionKey(session.id))).toBeGreaterThanOrEqual(MINUTE)
    expect((await getUploadSession(redis, session.id))?.status).toBe('processing')
  })

  it('keeps the stored expiresAt in lockstep with the Redis key TTL on touch', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)

    clock.advance(10 * MINUTE)
    await touchUploadSession(redis, session.id, clock.now)

    const touched = await getUploadSession(redis, session.id)
    const keyTtlMs = fake.pttlOf(sessionKey(session.id))
    const storedTtlMs = touched!.expiresAt.getTime() - clock.millis()

    expect(touched!.expiresAt.getTime()).toBeGreaterThan(clock.millis())
    expect(storedTtlMs).toBe(keyTtlMs)
  })

  it("extends by the session's own ttlSec rather than shrinking to the 10-minute default", async () => {
    const { clock, fake, redis } = harness()

    // A one-hour file-library session.
    const session = await createUploadSession(redis, makeConfig(60 * 60), clock.now)

    clock.advance(5 * MINUTE)
    await touchUploadSession(redis, session.id, clock.now)

    // A touch must never cut a long-lived session down to the default.
    expect(fake.pttlOf(sessionKey(session.id))).toBe(60 * 60 * 1000)
  })

  it('preserves remaining TTL on a normal in-window patch', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)

    clock.advance(5 * MINUTE)
    await patchUploadSession(redis, session.id, { status: 'uploading' }, clock.now)

    expect(fake.pttlOf(sessionKey(session.id))).toBe(10 * MINUTE)
  })

  it('floors a nearly-dead key and rewrites expiresAt to match it', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)

    // 10 seconds left: below the floor, and a raw SETEX of 0 would be an error.
    clock.advance(15 * MINUTE - 10_000)
    await patchUploadSession(redis, session.id, { status: 'processing' }, clock.now)

    expect(fake.pttlOf(sessionKey(session.id))).toBe(MINUTE)

    // The stored value must not still claim an expiry the key no longer has.
    const patched = await getUploadSession(redis, session.id)
    expect(patched!.expiresAt.getTime() - clock.millis()).toBe(MINUTE)
  })

  it('404s a patch against a session that is already gone', async () => {
    const { clock, redis } = harness()

    await expect(
      patchUploadSession(redis, 'nonexistent-session', { status: 'failed' }, clock.now)
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('treats touching a dead session as a no-op', async () => {
    const { clock, redis } = harness()

    await expect(
      touchUploadSession(redis, 'nonexistent-session', clock.now)
    ).resolves.toBeUndefined()
  })
})

describe('upload session compare-and-set', () => {
  /**
   * The production race: `parts` touches the session while `complete` patches
   * it. Both used to be GET → merge → SETEX, so whichever wrote second silently
   * discarded the other's field.
   */
  it('does not let a concurrent touch discard a status write', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)

    const original = fake.redis.eval
    let injected = false
    fake.redis.eval = async (script, numKeys, ...args) => {
      if (!injected) {
        // The `parts` route touches the same key in the window between this
        // patch's GET and its write. The flag also stops the touch's own eval
        // from recursing.
        injected = true
        await touchUploadSession(redis, session.id, clock.now)
      }
      return original(script, numKeys, ...args)
    }

    await patchUploadSession(redis, session.id, { status: 'processing' }, clock.now)
    fake.redis.eval = original

    const final = await getUploadSession(redis, session.id)
    // Pre-CAS, the patch's SETEX wrote a value merged from the PRE-touch read,
    // so the extension was rolled back to the original expiresAt.
    expect(final?.status).toBe('processing')
    expect(final!.expiresAt.getTime()).toBe(clock.millis() + 15 * MINUTE)
  })

  it('retries a lost compare-and-set and lands the merge on the newer value', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)
    const key = sessionKey(session.id)

    // One interleaved writer: the first CAS attempt loses because the key
    // changes between this patch's GET and its write.
    const original = fake.redis.eval
    let evals = 0
    fake.redis.eval = async (script, numKeys, ...args) => {
      evals += 1
      if (evals === 1) {
        const stolen = JSON.parse(fake.raw(key)!)
        stolen.uploadId = 'mpu-from-another-request'
        fake.seed(key, JSON.stringify(stolen), 15 * MINUTE)
      }
      return original(script, numKeys, ...args)
    }

    await patchUploadSession(redis, session.id, { status: 'processing' }, clock.now)

    const final = await getUploadSession(redis, session.id)
    expect(evals).toBe(2)
    // Both writes survive: the retry merged onto the interleaved value.
    expect(final?.status).toBe('processing')
    expect(final?.uploadId).toBe('mpu-from-another-request')
  })

  it('gives up with a 409 when every attempt loses the race', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)
    const key = sessionKey(session.id)

    // A writer that always wins the race, so no attempt can ever land.
    const original = fake.redis.eval
    let churn = 0
    fake.redis.eval = async (script, numKeys, ...args) => {
      churn += 1
      const stolen = JSON.parse(fake.raw(key)!)
      stolen.uploadId = `mpu-${churn}`
      fake.seed(key, JSON.stringify(stolen), 15 * MINUTE)
      return original(script, numKeys, ...args)
    }

    await expect(
      patchUploadSession(redis, session.id, { status: 'processing' }, clock.now)
    ).rejects.toBeInstanceOf(ConflictError)
    expect(churn).toBe(5)
  })

  it('never lets a millisecond TTL reach Redis as a number', async () => {
    const { clock, fake, redis } = harness()

    const session = await createUploadSession(redis, makeConfig(15 * 60), clock.now)

    const original = fake.redis.eval
    let ttlArg: unknown
    fake.redis.eval = async (script, numKeys, ...args) => {
      ttlArg = args[3]
      return original(script, numKeys, ...args)
    }

    await patchUploadSession(redis, session.id, { status: 'uploading' }, clock.now)

    // Lua formats numbers with `%.14g`; a millisecond value that becomes a Lua
    // number on the way through can round into scientific notation.
    expect(typeof ttlArg).toBe('string')
    expect(ttlArg).toBe(String(15 * MINUTE))
  })
})
