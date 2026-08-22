// apps/web/src/app/api/files/upload/[sessionId]/authorize-upload-session.ts

import { getUploadSession, uploadSessionRedis } from '@auxx/lib/files/server'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '~/auth/server'

/** The Redis-backed upload session, as `getUploadSession` hands it back. */
type UploadSession = NonNullable<Awaited<ReturnType<typeof getUploadSession>>>

export interface AuthorizedUploadSession {
  session: UploadSession
  caller: { id: string; organizationId: string }
}

/**
 * Body shape matches `UploadErrorHandler`'s so every failure on this surface
 * looks the same to the client, whichever layer produced it.
 */
function deny(status: number, code: string, errorType: string, message: string): Response {
  return NextResponse.json({ error: message, errorType, retryable: false, code }, { status })
}

/**
 * Authenticate the caller and bind them to an upload session.
 *
 * `complete`, `parts` and `events` used to treat the session nanoid as the only
 * credential, so anyone holding it could finish someone else's upload, mint
 * presigned part URLs for arbitrary part numbers, or read upload status
 * (`docs/files-upload-architecture-guide.md` §11.4). This re-resolves the caller
 * from the auth cookie and asserts the session belongs to them, which also
 * re-evaluates authorization at completion time rather than only at session
 * create.
 *
 * Order is deliberate: authentication is checked **before** Redis is touched, so
 * an unauthenticated caller gets 401 whether or not the session id exists and
 * cannot use the endpoint to probe for live sessions.
 *
 * @param sessionId - The upload session nanoid from the route segment.
 * @returns `{ session, caller }` when the caller owns the session, otherwise a
 *   `Response` to return as-is (401 unauthenticated, 404 unknown session, 403
 *   session owned by another user or organization).
 */
export async function authorizeUploadSession(
  sessionId: string
): Promise<AuthorizedUploadSession | Response> {
  const authSession = await auth.api.getSession({ headers: await headers() })
  const callerId = authSession?.user?.id
  const callerOrgId = authSession?.user?.defaultOrganizationId

  if (!callerId || !callerOrgId) {
    return deny(401, 'UNAUTHORIZED', 'authentication', 'User session required')
  }

  const session = await getUploadSession(await uploadSessionRedis(), sessionId)
  if (!session) {
    return deny(404, 'SESSION_NOT_FOUND', 'validation', 'Upload session not found or expired')
  }

  if (session.userId !== callerId || session.organizationId !== callerOrgId) {
    return deny(403, 'FORBIDDEN', 'permission', 'Upload session does not belong to this user')
  }

  return { session, caller: { id: callerId, organizationId: callerOrgId } }
}
