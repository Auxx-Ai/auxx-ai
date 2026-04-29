// packages/credentials/src/local-session/index.ts
// Shared local-session helpers for satellite Next.js apps (build, kb, ...).
//
// Each satellite app mints its own short-lived HS256 JWT cookie after a
// cross-app login token has been verified. The shape is identical across apps
// — only the cookie name, secret, and TTL differ. This factory captures that
// shape so we don't fork the logic.
//
// Redis (for jti single-use) and the cookie store (next/headers) are injected
// to avoid `@auxx/credentials` taking a hard dependency on `@auxx/redis`
// (circular) or `next` (peer-only).

import { jwtVerify, SignJWT } from 'jose'
import { configService } from '../config'

/** User payload carried in the local session JWT */
export interface LocalSession {
  userId: string
  email: string
}

/** Minimal cookie-store interface — matches `next/headers`' `cookies()` return value */
export interface CookieStoreLike {
  get(name: string): { value: string } | undefined
}

/** Minimal redis-client interface — matches `ioredis` for SET NX EX */
export interface RedisLike {
  set(
    key: string,
    value: string,
    expireMode: 'EX',
    seconds: number,
    setMode: 'NX'
  ): Promise<unknown>
}

export interface LocalSessionConfig {
  /** Cookie name for the local session, e.g. `auxx-build.session` */
  cookieName: string
  /** Env key for the HS256 signing secret, e.g. `BUILD_SESSION_SECRET` */
  secretEnv: string
  /** Session lifetime in seconds */
  ttlSeconds: number
  /** Reads the request cookie store (typically `() => cookies()` from `next/headers`) */
  getCookieStore: () => Promise<CookieStoreLike>
  /** Returns a redis client for single-use jti tracking. Optional; if omitted, jti consumption no-ops to `false`. */
  getRedis?: () => Promise<RedisLike | null>
}

export interface LocalSessionHelpers {
  createSession(user: LocalSession): Promise<string>
  verifySession(token: string): Promise<LocalSession | null>
  getSession(): Promise<LocalSession | null>
  consumeLoginTokenJti(jti: string): Promise<boolean>
}

export function createLocalSessionHelpers(config: LocalSessionConfig): LocalSessionHelpers {
  function getSecret(): Uint8Array {
    const secret = configService.get<string>(config.secretEnv)
    if (!secret) throw new Error(`${config.secretEnv} not configured`)
    return new TextEncoder().encode(secret)
  }

  async function createSession(user: LocalSession): Promise<string> {
    return new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.userId)
      .setIssuedAt()
      .setExpirationTime(`${config.ttlSeconds}s`)
      .sign(getSecret())
  }

  async function verifySession(token: string): Promise<LocalSession | null> {
    try {
      const { payload } = await jwtVerify(token, getSecret())
      if (!payload.sub || !payload.email) return null
      return { userId: payload.sub, email: payload.email as string }
    } catch {
      return null
    }
  }

  async function getSession(): Promise<LocalSession | null> {
    const store = await config.getCookieStore()
    const cookie = store.get(config.cookieName)
    if (!cookie?.value) return null
    return verifySession(cookie.value)
  }

  async function consumeLoginTokenJti(jti: string): Promise<boolean> {
    if (!config.getRedis) return false
    const redis = await config.getRedis()
    if (!redis) return false
    const result = await redis.set(`login-token:${jti}`, 'consumed', 'EX', 600, 'NX')
    return result === 'OK'
  }

  return { createSession, verifySession, getSession, consumeLoginTokenJti }
}
