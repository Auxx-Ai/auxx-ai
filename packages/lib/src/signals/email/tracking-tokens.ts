// packages/lib/src/signals/email/tracking-tokens.ts
// Stateless signed tracking tokens for the open-pixel and click-redirect endpoints (Phase 2 of
// plans/signals/02-email-engagement.md "Open + click tracking"). Mirrors the jose HS256 shape
// of `../unsubscribe.ts` — same secret + `configService` pattern, own `scope` claim. Unlike the
// unsubscribe token, this one carries NO expiry: an open/click on a months-old email must still
// resolve, so the token has to stay verifiable indefinitely.

import { createHash } from 'node:crypto'
import { TRACK_URL } from '@auxx/config/urls'
import { configService } from '@auxx/credentials'
import { jwtVerify, SignJWT } from 'jose'
import { Result, type TypedResult } from '../../result'

/** Discriminates this token from every other JWT the app issues (passports, unsubscribe, login). */
const TRACKING_TOKEN_SCOPE = 'email-track' as const

/**
 * Read the shared JWT signing secret. Same env var + fallback as `../unsubscribe.ts`
 * (`PUBLIC_WORKFLOW_JWT_SECRET`) — one shared secret, discriminated by `scope`.
 */
function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(
    configService.get<string>('PUBLIC_WORKFLOW_JWT_SECRET') || 'public-workflow-secret-change-me'
  )
}

/** Raw JWT claim shape — kept compact ('o', 'c', 'ch', 'u'...) since these land in URLs. */
interface TrackingTokenClaims {
  scope: typeof TRACKING_TOKEN_SCOPE
  /** 'o' = open pixel, 'c' = click redirect. */
  t: 'o' | 'c'
  /** organizationId */
  o: string
  /** messageId (the Message DB row id) */
  m: string
  /** contactEntityInstanceId, if known at send time */
  c?: string
  /** channelId, if known at send time */
  ch?: string
  /** hex sha256 of the exact original URL — click tokens only */
  u?: string
}

/** Normalized tracking-token payload, decoupled from the compact wire claim names. */
export interface TrackingTokenPayload {
  type: 'open' | 'click'
  organizationId: string
  messageId: string
  contactEntityInstanceId?: string
  channelId?: string
  /** hex sha256 of the exact original URL — present on click tokens only. */
  urlHash?: string
}

interface IssueTokenInput {
  organizationId: string
  messageId: string
  contactEntityInstanceId?: string
  channelId?: string
}

async function signTrackingToken(claims: TrackingTokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(getJwtSecret())
}

/** Issues a signed open-pixel token — no DB row, no expiry (opens can fire months after send). */
export async function issueOpenToken(input: IssueTokenInput): Promise<string> {
  return signTrackingToken({
    scope: TRACKING_TOKEN_SCOPE,
    t: 'o',
    o: input.organizationId,
    m: input.messageId,
    ...(input.contactEntityInstanceId ? { c: input.contactEntityInstanceId } : {}),
    ...(input.channelId ? { ch: input.channelId } : {}),
  })
}

/**
 * Issues a signed click-redirect token, binding the token to the exact original URL via a
 * sha256 hash claim ({@link verifyClickUrl} re-checks it at redirect time so a token can't be
 * replayed against a different URL).
 */
export async function issueClickToken(input: IssueTokenInput & { url: string }): Promise<string> {
  return signTrackingToken({
    scope: TRACKING_TOKEN_SCOPE,
    t: 'c',
    o: input.organizationId,
    m: input.messageId,
    ...(input.contactEntityInstanceId ? { c: input.contactEntityInstanceId } : {}),
    ...(input.channelId ? { ch: input.channelId } : {}),
    u: hashUrl(input.url),
  })
}

/** Verifies signature + scope. Rejects any token not minted by {@link issueOpenToken}/{@link issueClickToken}. */
export async function verifyTrackingToken(
  token: string
): Promise<TypedResult<TrackingTokenPayload, Error>> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    if (payload.scope !== TRACKING_TOKEN_SCOPE) {
      return Result.error(new Error('Invalid tracking token scope'))
    }
    const claims = payload as unknown as TrackingTokenClaims
    if (
      (claims.t !== 'o' && claims.t !== 'c') ||
      typeof claims.o !== 'string' ||
      typeof claims.m !== 'string'
    ) {
      return Result.error(new Error('Malformed tracking token payload'))
    }
    return Result.ok({
      type: claims.t === 'o' ? 'open' : 'click',
      organizationId: claims.o,
      messageId: claims.m,
      ...(claims.c ? { contactEntityInstanceId: claims.c } : {}),
      ...(claims.ch ? { channelId: claims.ch } : {}),
      ...(claims.u ? { urlHash: claims.u } : {}),
    })
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error('Invalid tracking token'))
  }
}

/** hex sha256 of a URL, used to bind a click token to its original destination. */
function hashUrl(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex')
}

/**
 * Re-checks a click token's URL hash against the URL a redirect is about to serve — guards
 * against a token being replayed with a swapped `u=` query param at the redirect endpoint.
 */
export function verifyClickUrl(payload: TrackingTokenPayload, url: string): boolean {
  return payload.urlHash === hashUrl(url)
}

/** Builds the public `/t/o/:token` open-pixel URL embedded in the instrumented HTML. */
export function buildOpenPixelUrl(token: string): string {
  return `${TRACK_URL}/t/o/${token}`
}

/** Builds the public `/t/c/:token?u=...` click-redirect URL an `<a href>` is rewritten to. */
export function buildClickTrackingUrl(token: string, originalUrl: string): string {
  return `${TRACK_URL}/t/c/${token}?u=${encodeURIComponent(originalUrl)}`
}
