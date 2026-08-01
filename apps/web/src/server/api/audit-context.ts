// apps/web/src/server/api/audit-context.ts
// Bridges a tRPC procedure context to the audit-log writer: derives actor + request
// context (IP / user-agent / session) and forwards to recordAudit. This is the Path-A
// entry point — call it from protected/admin procedures after a successful mutation.

import { type AuditContext, type AuditInput, recordAudit } from '@auxx/lib/audit-log'

/** Minimal slice of the tRPC ctx the audit bridge needs. */
interface AuditableCtx {
  headers?: Headers
  session: {
    user: { id: string }
    organizationId?: string | null
    /**
     * The Session ROW id, flat on the session object — `customSession` in
     * auth/server.ts returns `{ ...session, user }`, so there is no nested
     * `.session` here (reading one silently wrote `sessionId: null` on every
     * audit row until 2026-08-01).
     */
    id?: string | null
  }
}

/** Left-most public client IP from forwarding headers; falls back to x-real-ip. */
function clientIp(headers?: Headers): string | null {
  if (!headers) return null
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') ?? null
}

/**
 * Build an audit context (IP / user-agent) from raw request headers. Use from
 * non-tRPC request handlers — e.g. better-auth hooks — where there is no tRPC ctx.
 * `sessionId` is left null since it isn't derivable from headers alone.
 */
export function requestAuditContext(headers?: Headers): AuditContext {
  return {
    ipAddress: clientIp(headers),
    userAgent: headers?.get('user-agent') ?? null,
    sessionId: null,
  }
}

/**
 * Record an audit event from a request handler, capturing IP/UA/session from `ctx`.
 * Defaults `organizationId` and `actorId` from the session and `actorType` to 'user';
 * any field can be overridden via `input`. Fire-and-forget safe — never throws.
 */
export function recordAuditFromCtx(
  ctx: AuditableCtx,
  input: Omit<AuditInput, 'organizationId' | 'actorType' | 'actorId' | 'context'> &
    Partial<Pick<AuditInput, 'organizationId' | 'actorType' | 'actorId'>>
) {
  return recordAudit({
    ...input,
    organizationId:
      input.organizationId !== undefined
        ? input.organizationId
        : (ctx.session.organizationId ?? null),
    actorType: input.actorType ?? 'user',
    actorId: input.actorId ?? ctx.session.user.id,
    context: {
      ipAddress: clientIp(ctx.headers),
      userAgent: ctx.headers?.get('user-agent') ?? null,
      sessionId: ctx.session.id ?? null,
    },
  })
}
