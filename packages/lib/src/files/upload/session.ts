// packages/lib/src/files/upload/session.ts

/**
 * Redis-backed upload sessions.
 *
 * Replaces the static-only `SessionManager` class. There was never any instance
 * state on it — every member was `static`, and the one collaborator it had
 * (Redis) was resolved *inside* each method via `getRedisClient(true)`. That is
 * the same module-scope binding `files/ctx.ts` exists to delete: testing the
 * session lifecycle meant `vi.mock('@auxx/redis')` at hoist scope, which drags
 * `credential-lock.ts`'s module-scope provider along with it.
 *
 * So `redis` is a **parameter** on every function here. Production resolves it
 * once with {@link uploadSessionRedis}; a test passes the `Map`-backed double
 * from `files/__tests__/support/redis.ts` and mocks nothing.
 *
 * ## These functions throw; they do not return `Result`
 *
 * A deliberate exception to the `files/` `Result` convention, and the one place
 * in this phase where the plan's own signatures (§4.4) and
 * `docs/lib-module-guide.md` disagree. Every caller today is a route handler
 * inside a `try/catch`, and `prepareUpload`/`completeUpload` (§4.7) are where the
 * `guard` boundary is specified to sit. Returning `Result` here would add an
 * `isErr()` unwrap to six call sites that immediately rethrow, and 4e would
 * delete all six. What is *not* optional is the error type: only `AuxxError`
 * subclasses cross this boundary, so `auxxErrorMiddleware` and the routes'
 * `isAuxxError` mapping keep their statuses.
 *
 * ## Writes are compare-and-set, because two routes race on one key
 *
 * `parts` calls {@link touchUploadSession} while `complete` calls
 * {@link patchUploadSession} on the same session id. Both used to be
 * GET → merge in JS → SETEX, so the later write silently discarded whatever the
 * other had just stored — a `status: 'processing'` could be reverted by a part
 * request that only meant to extend the TTL.
 *
 * {@link CAS_SET_SCRIPT} closes that: the write lands only if the stored value is
 * byte-identical to the one the merge was computed from, otherwise the caller
 * re-reads and retries. Comparing the whole serialized session rather than a
 * version field means no schema change and no `cjson` round trip inside Lua —
 * which matters, because `cjson.encode` re-formats every number through Lua's
 * `%.14g` (the repo gotcha that corrupts millisecond cursors) and collapses an
 * empty array into `{}`. Nothing in this file lets a number become a string
 * inside Lua: the TTL is passed in already stringified and handed straight to
 * `PX`.
 */

import { createScopedLogger } from '@auxx/logger'
import { getRedisClient, type RedisClient } from '@auxx/redis'
import { nanoid } from 'nanoid'
import { AuxxError, BadRequestError, ConflictError, NotFoundError } from '../../errors'
import type { UploadPreparedConfig } from './init-types'
import type { PresignedUploadSession } from './session-types'

const logger = createScopedLogger('upload-session')

const SESSION_KEY_PREFIX = 'upload:session:'

/** Fallback lifetime for a session whose config recorded a non-positive `ttlSec`. */
const DEFAULT_TTL_MS = 10 * 60 * 1000

/**
 * Floor applied when rewriting a session's key.
 *
 * Redis rejects a non-positive expiry outright, and a one-second key would
 * evaporate mid-completion — so a write against a session whose remaining TTL
 * has run down buys enough time to finish the flow already in progress. The key
 * is only ever rewritten for a session Redis still holds, so the floor cannot
 * resurrect an evicted session; it only keeps a live one alive.
 */
const MIN_UPDATE_TTL_MS = 60 * 1000

/** How many times a losing CAS re-reads before giving up. */
const CAS_MAX_ATTEMPTS = 5

/**
 * Compare-and-set the whole session value, preserving nothing implicitly.
 *
 * `KEYS[1]` = session key. `ARGV` = expected value, next value, TTL in
 * milliseconds **as a string**. Returns 1 written, 0 conflict, -1 key gone.
 *
 * The TTL crosses as a string and is forwarded to `PX` untouched: Lua's default
 * number formatting is `%.14g`, so any millisecond value that becomes a Lua
 * number on the way through risks scientific notation. Nothing here converts it.
 */
const CAS_SET_SCRIPT = `
-- auxx:upload-session:cas-set
local current = redis.call('GET', KEYS[1])
if not current then return -1 end
if current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`.trim()

/**
 * The five Redis commands this module actually issues.
 *
 * Same reasoning as `FilesDepsSlice` in `files/ctx.ts`: a `RedisClient`
 * parameter would say these functions may publish, subscribe, scan the keyspace
 * or open a pipeline, and it would force every test double to satisfy ~50
 * members or reach for an `as unknown as RedisClient` cast — the kind of cast
 * that hides a method name nothing implements (#1832). A real `RedisClient`
 * satisfies this structurally, so production callers are unaffected.
 */
export type UploadSessionRedis = Pick<RedisClient, 'get' | 'setex' | 'del' | 'pttl' | 'eval'>

/** Outcome of one {@link CAS_SET_SCRIPT} round. */
type CasOutcome = 'written' | 'conflict' | 'missing'

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`
}

/**
 * Revive a stored session. `createdAt`/`expiresAt` are `Date`s in the type and
 * ISO strings on the wire, and callers do date arithmetic on both.
 */
function parseSession(sessionId: string, raw: string): PresignedUploadSession {
  let session: PresignedUploadSession
  try {
    session = JSON.parse(raw) as PresignedUploadSession
  } catch {
    throw new AuxxError(`Upload session ${sessionId} holds unreadable JSON`)
  }

  session.createdAt = new Date(session.createdAt)
  session.expiresAt = new Date(session.expiresAt)
  return session
}

async function casSet(
  redis: UploadSessionRedis,
  key: string,
  expected: string,
  next: string,
  ttlMs: number
): Promise<CasOutcome> {
  const reply = await redis.eval(
    CAS_SET_SCRIPT,
    1,
    key,
    expected,
    next,
    String(Math.max(1, Math.round(ttlMs)))
  )

  const code = Number(reply)
  if (code === 1) return 'written'
  if (code === 0) return 'conflict'
  return 'missing'
}

/**
 * Resolve the Redis client production uses for upload sessions.
 *
 * Upload sessions have no in-memory fallback, so an unavailable Redis is a hard
 * failure rather than a silently skipped write. This is the only place in the
 * module that reaches for a client instead of being handed one.
 */
export async function uploadSessionRedis(): Promise<RedisClient> {
  const client = await getRedisClient(true)
  if (!client) {
    throw new AuxxError('Redis is required for upload sessions but is unavailable')
  }
  return client
}

/**
 * Create a session from a prepared upload config and store it under its own TTL.
 *
 * @param redis The client to write through.
 * @param config The prepared config — the single source of truth for everything
 *   persisted here. Nothing is re-derived.
 * @param now The clock, threaded in so `createdAt`/`expiresAt` are assertable
 *   without process-global fake timers.
 */
export async function createUploadSession(
  redis: UploadSessionRedis,
  config: UploadPreparedConfig,
  now: () => Date
): Promise<PresignedUploadSession> {
  if (!(config.ttlSec > 0)) {
    // SETEX rejects a non-positive expiry with a raw ioredis error; a typed 400
    // names the actual problem instead.
    throw new BadRequestError(
      `Upload session for ${config.fileName} was prepared with a non-positive ttlSec (${config.ttlSec})`
    )
  }

  const sessionId = nanoid()
  const createdAt = now()

  const session: PresignedUploadSession = {
    version: 2,
    id: sessionId,
    organizationId: config.organizationId,
    userId: config.userId,
    entityType: config.entityType,
    entityId: config.entityId,
    fileName: config.fileName,
    mimeType: config.mimeType,
    expectedSize: config.expectedSize,
    provider: config.provider,
    storageKey: config.storageKey,
    credentialId: config.credentialId,
    isMultipart: config.uploadPlan.strategy === 'multipart',
    // Overwritten by the route once the storage provider has answered.
    uploadMethod: 'PUT',
    status: 'created',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + config.ttlSec * 1000),
    ttlSec: config.ttlSec,
    metadata: config.metadata || {},
    policy: config.policy,
    uploadPlan: config.uploadPlan,
    bucket: config.bucket,
    visibility: config.visibility,
  }

  await redis.setex(sessionKey(sessionId), config.ttlSec, JSON.stringify(session))

  logger.info('Created presigned upload session from config', {
    sessionId,
    organizationId: session.organizationId,
    entityType: session.entityType,
    fileName: session.fileName,
    size: session.expectedSize,
    provider: session.provider,
    strategy: config.uploadPlan.strategy,
  })

  return session
}

/** Read one session, or `null` when Redis no longer holds it. */
export async function getUploadSession(
  redis: UploadSessionRedis,
  sessionId: string
): Promise<PresignedUploadSession | null> {
  const raw = await redis.get(sessionKey(sessionId))
  if (!raw) return null
  return parseSession(sessionId, raw)
}

/**
 * Merge `patch` into a live session, preserving the key's remaining lifetime.
 *
 * The remaining TTL is read from `PTTL` — the key's own ground truth — rather
 * than recomputed from the stored `expiresAt`. That is the Tier-1 §1.6 fix made
 * unloseable: the old arithmetic clamped to a non-positive expiry the moment
 * `expiresAt` drifted into the past (a multipart upload that outlived its
 * original window), and ioredis then failed a completion whose bytes were
 * already in S3. When the remaining lifetime is under {@link MIN_UPDATE_TTL_MS}
 * the key is floored to it *and* `expiresAt` is rewritten from `now`, so the
 * stored value and the key TTL never disagree.
 *
 * @throws {NotFoundError} when the session is gone — the caller's status write
 *   had nothing to land on.
 * @throws {ConflictError} when {@link CAS_MAX_ATTEMPTS} rounds all lost.
 */
export async function patchUploadSession(
  redis: UploadSessionRedis,
  sessionId: string,
  patch: Partial<PresignedUploadSession>,
  now: () => Date
): Promise<void> {
  const key = sessionKey(sessionId)

  for (let attempt = 1; attempt <= CAS_MAX_ATTEMPTS; attempt++) {
    const current = await redis.get(key)
    if (!current) throw new NotFoundError(`Upload session ${sessionId} not found`)

    const remainingMs = await redis.pttl(key)
    const merged: PresignedUploadSession = { ...parseSession(sessionId, current), ...patch }

    let ttlMs = remainingMs
    if (!(ttlMs > MIN_UPDATE_TTL_MS)) {
      ttlMs = MIN_UPDATE_TTL_MS
      merged.expiresAt = new Date(now().getTime() + ttlMs)
    }

    const outcome = await casSet(redis, key, current, JSON.stringify(merged), ttlMs)
    if (outcome === 'written') return
    if (outcome === 'missing') {
      throw new NotFoundError(`Upload session ${sessionId} expired while being updated`)
    }

    logger.debug('Upload session patch lost a compare-and-set; retrying', { sessionId, attempt })
  }

  throw new ConflictError(
    `Upload session ${sessionId} was rewritten by another request ${CAS_MAX_ATTEMPTS} times`
  )
}

/**
 * Extend a session's lifetime during an active upload.
 *
 * Extends by the session's own `ttlSec` — the lifetime its handler asked for —
 * so touching a long-lived multipart session can never shrink it to the
 * ten-minute default. The refreshed `expiresAt` is written back **with** the key
 * so the stored value and the Redis TTL stay in lockstep; letting them drift is
 * what made {@link patchUploadSession} compute a negative expiry.
 *
 * A no-op when the session is already gone: a touch is a best-effort extension,
 * and the caller (the `parts` route) has its own 404 path. Losing the
 * compare-and-set {@link CAS_MAX_ATTEMPTS} times logs and returns rather than
 * throwing, for the same reason — whoever won those races just rewrote the key,
 * so the session is demonstrably alive and a part presign must not 500 over a
 * TTL that was already extended by someone else.
 */
export async function touchUploadSession(
  redis: UploadSessionRedis,
  sessionId: string,
  now: () => Date
): Promise<void> {
  const key = sessionKey(sessionId)

  for (let attempt = 1; attempt <= CAS_MAX_ATTEMPTS; attempt++) {
    const current = await redis.get(key)
    if (!current) return

    const session = parseSession(sessionId, current)
    const extendMs = session.ttlSec > 0 ? session.ttlSec * 1000 : DEFAULT_TTL_MS
    const refreshed: PresignedUploadSession = {
      ...session,
      expiresAt: new Date(now().getTime() + extendMs),
    }

    const outcome = await casSet(redis, key, current, JSON.stringify(refreshed), extendMs)
    if (outcome !== 'conflict') return

    logger.debug('Upload session touch lost a compare-and-set; retrying', { sessionId, attempt })
  }

  logger.warn('Upload session touch gave up after repeated compare-and-set conflicts', {
    sessionId,
  })
}

/** Remove a session. Deleting one that is already gone is not an error. */
export async function deleteUploadSession(
  redis: UploadSessionRedis,
  sessionId: string
): Promise<void> {
  await redis.del(sessionKey(sessionId))
}
