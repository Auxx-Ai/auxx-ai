// packages/lib/src/signals/unsubscribe.ts
// Stateless signed unsubscribe tokens for the List-Unsubscribe / one-click flow (plans/
// signals/02-email-engagement.md "List-Unsubscribe + one-click"). Mirrors the jose HS256
// shape of `packages/credentials/src/passport/issue-passport.ts` — a dedicated scope
// literal rather than a `PassportScope` union member, since this token belongs to the
// email-engagement pipeline, not the passport system, and `@auxx/credentials` stays free
// of a `@auxx/lib`-only concern.

import { API_URL } from '@auxx/config/urls'
import { configService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { jwtVerify, SignJWT } from 'jose'
import { Result, type TypedResult } from '../result'
import { upsertSuppression } from '../sequences/suppression'
import { recordSignal, toSignalRecordKey } from './record-signal'

const logger = createScopedLogger('signals-unsubscribe')

/** Discriminates this token from every other JWT the app issues (passports, login tokens). */
const UNSUBSCRIBE_TOKEN_SCOPE = 'email-unsubscribe' as const

/** List-Unsubscribe links must keep working for as long as an old email might sit unread. */
const TOKEN_EXPIRY = '180d'

/**
 * Read the shared JWT signing secret.
 *
 * NOTE: reuses the passport system's env var (`PUBLIC_WORKFLOW_JWT_SECRET`) rather than
 * minting a dedicated one — same secret, different `scope` claim, same precedent as every
 * other stateless-token issuer in the app (see `issue-passport.ts`).
 */
function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(
    configService.get<string>('PUBLIC_WORKFLOW_JWT_SECRET') || 'public-workflow-secret-change-me'
  )
}

export interface UnsubscribeTokenPayload {
  scope: typeof UNSUBSCRIBE_TOKEN_SCOPE
  organizationId: string
  contactEntityInstanceId: string
  /** Normalized (trimmed + lowercased) at issue time. */
  email: string
  /** Originating integration/channel, if known — carried through for provenance only. */
  channelId?: string
  iat: number
  exp: number
}

/**
 * Issues a signed, stateless unsubscribe token — the token IS the capability, no DB row.
 * 180-day expiry: an old campaign email's List-Unsubscribe link must keep resolving long
 * after send.
 */
export async function issueUnsubscribeToken(input: {
  organizationId: string
  contactEntityInstanceId: string
  email: string
  channelId?: string
}): Promise<TypedResult<string, Error>> {
  try {
    const token = await new SignJWT({
      scope: UNSUBSCRIBE_TOKEN_SCOPE,
      organizationId: input.organizationId,
      contactEntityInstanceId: input.contactEntityInstanceId,
      email: input.email.trim().toLowerCase(),
      ...(input.channelId ? { channelId: input.channelId } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(TOKEN_EXPIRY)
      .sign(getJwtSecret())

    return Result.ok(token)
  } catch (error) {
    return Result.error(
      error instanceof Error ? error : new Error('Failed to issue unsubscribe token')
    )
  }
}

/** Verifies signature + expiry + scope. Rejects any token not minted by {@link issueUnsubscribeToken}. */
export async function verifyUnsubscribeToken(
  token: string
): Promise<TypedResult<UnsubscribeTokenPayload, Error>> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    if (payload.scope !== UNSUBSCRIBE_TOKEN_SCOPE) {
      return Result.error(new Error('Invalid unsubscribe token scope'))
    }
    if (
      typeof payload.organizationId !== 'string' ||
      typeof payload.contactEntityInstanceId !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      return Result.error(new Error('Malformed unsubscribe token payload'))
    }
    return Result.ok(payload as unknown as UnsubscribeTokenPayload)
  } catch (error) {
    return Result.error(
      error instanceof Error ? error : new Error('Invalid or expired unsubscribe token')
    )
  }
}

/** Builds the public `/u/:token` link embedded in the `List-Unsubscribe` header. */
export function buildUnsubscribeUrl(token: string): string {
  return `${API_URL}/u/${token}`
}

/**
 * Processes an unsubscribe click/one-click POST — idempotent, safe to call repeatedly for
 * the same token (a re-clicked link, a retried one-click POST). Records the
 * `contact:unsubscribed` signal (day-scoped dedupe — `recordSignal`'s rollup path sets
 * `EntitySignalRollup.unsubscribedAt`, not duplicated here) and ALWAYS upserts the org-wide
 * suppression row, even when the signal write hit the dedupe index, so a stale/re-clicked
 * link still blocks future sends.
 */
export async function processUnsubscribe(
  payload: UnsubscribeTokenPayload,
  options: { source: 'one_click' | 'link' }
): Promise<TypedResult<void, Error>> {
  const { organizationId, contactEntityInstanceId, email } = payload
  const dedupeKey = `unsub:${organizationId}:${email}:${new Date().toISOString().slice(0, 10)}`

  const signalResult = await recordSignal({
    organizationId,
    kind: 'contact:unsubscribed',
    subtype: options.source,
    dedupeKey,
    contactEntityInstanceId,
    title: 'Unsubscribed from emails',
    links: [toSignalRecordKey('contact', contactEntityInstanceId)],
    metadata: { email, source: options.source },
  })
  if (!Result.isOk(signalResult)) return Result.error(signalResult.error)

  try {
    await upsertSuppression(database, {
      organizationId,
      email,
      contactEntityInstanceId,
      reason: 'unsubscribe',
    })
  } catch (error) {
    logger.error('Failed to upsert suppression after unsubscribe signal', {
      organizationId,
      email,
      error: error instanceof Error ? error.message : String(error),
    })
    return Result.error(error instanceof Error ? error : new Error('Failed to upsert suppression'))
  }

  return Result.ok(undefined)
}
