// apps/kb/src/app/auth/verify/route.ts
// Verifies an Ed25519 cross-app login token issued by apps/web and mints
// a local `auxx-kb.session` cookie. The cookie has no `domain` attribute
// so it correctly scopes to whatever host the request landed on (KB
// subdomain or a custom domain).

import { WEBAPP_URL } from '@auxx/config/urls'
import { configService } from '@auxx/credentials'
import { sanitizeReturnTo, verifyLoginToken } from '@auxx/credentials/login-token'
import { database, schema } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import { getDemoEmailDomain } from '@auxx/lib/demo'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { consumeLoginTokenJti, createLocalSession, KB_SESSION_COOKIE_NAME } from '~/lib/auth'

function getRequestOrigin(request: NextRequest): string {
  const host = request.headers.get('host')
  if (!host) return new URL(request.url).origin
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request)
  const loginToken = request.nextUrl.searchParams.get('loginToken')

  if (!loginToken) {
    return NextResponse.redirect(`${WEBAPP_URL}/`)
  }

  // 1. Verify token signature and claims (aud=requestOrigin, exp, iss)
  const result = await verifyLoginToken(loginToken, origin)
  if (result.isErr()) {
    return NextResponse.redirect(`${WEBAPP_URL}/login?callbackApp=kb&returnTo=/`)
  }

  const { userId, email, returnTo, jti } = result.value

  // 2. Block demo accounts
  if (email.endsWith(`@${getDemoEmailDomain()}`)) {
    return NextResponse.redirect(`${WEBAPP_URL}/kb-auth/no-access?reason=demo`)
  }

  // 3. Single-use jti via Redis SET NX EX
  const consumed = await consumeLoginTokenJti(jti)
  if (!consumed) {
    return NextResponse.redirect(`${WEBAPP_URL}/login?callbackApp=kb&returnTo=/`)
  }

  // 4. Resolve the KB on this host and re-check membership.
  // The aud check above already proves the token was minted for this origin,
  // but we still need to know which KB this host serves to verify membership.
  const [kbForHost] = await database
    .select({
      organizationId: schema.KnowledgeBase.organizationId,
    })
    .from(schema.KnowledgeBase)
    .where(eq(schema.KnowledgeBase.customDomain, new URL(origin).hostname))
    .limit(1)

  // If a customDomain row matches, gate on its org. Otherwise we're on the
  // KB_URL host which serves all KBs — defer the membership re-check to the
  // page-level layout (it has the kbId/orgSlug from URL params).
  if (kbForHost) {
    const member = await isOrgMember(kbForHost.organizationId, userId)
    if (!member) {
      return NextResponse.redirect(`${WEBAPP_URL}/kb-auth/no-access`)
    }
  }

  // 5. Mint local KB session cookie
  const sessionCookie = await createLocalSession({ userId, email })

  const safeReturnTo = sanitizeReturnTo(returnTo)
  const response = NextResponse.redirect(new URL(safeReturnTo, origin), { status: 303 })

  const isProduction = configService.get<string>('NODE_ENV') === 'production'
  response.cookies.set(KB_SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: isProduction || !!configService.get<string>('DOMAIN'),
    sameSite: 'lax',
    maxAge: 24 * 60 * 60,
    path: '/',
    // Intentionally no `domain` — defaults to the request host so the cookie
    // works on customer custom domains as well as the KB subdomain.
  })

  return response
}
