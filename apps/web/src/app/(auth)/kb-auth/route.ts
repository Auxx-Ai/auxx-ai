// apps/web/src/app/(auth)/kb-auth/route.ts
// Cross-app bounce target for users landing on an INTERNAL KB without a
// local KB session cookie. Authenticates via better-auth, issues an
// Ed25519 login token bound to the KB's origin, and redirects to the
// KB's `/auth/verify` route which mints `auxx-kb.session`.

import { WEBAPP_URL } from '@auxx/config/server'
import { issueLoginToken, sanitizeReturnTo } from '@auxx/credentials/login-token'
import { database, schema } from '@auxx/database'
import { isOrgMember } from '@auxx/lib/cache'
import { getDemoEmailDomain } from '@auxx/lib/demo'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { resolveTrustedAppOrigin } from '~/auth/trusted-apps'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const kbId = url.searchParams.get('kbId')
  const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'))

  if (!kbId) {
    return NextResponse.redirect(new URL('/', WEBAPP_URL))
  }

  // 1. Look up the KB
  const [kb] = await database
    .select({
      id: schema.KnowledgeBase.id,
      organizationId: schema.KnowledgeBase.organizationId,
      visibility: schema.KnowledgeBase.visibility,
    })
    .from(schema.KnowledgeBase)
    .where(eq(schema.KnowledgeBase.id, kbId))
    .limit(1)

  if (!kb) {
    return NextResponse.redirect(new URL('/kb-auth/no-access?reason=missing', WEBAPP_URL))
  }

  // 2. Resolve target origin (handles verified custom domains)
  const targetOrigin = await resolveTrustedAppOrigin('kb', { kbId })
  if (!targetOrigin) {
    return NextResponse.redirect(new URL('/kb-auth/no-access?reason=missing', WEBAPP_URL))
  }

  // 3. Public KBs don't need a token — bounce straight to the KB.
  if (kb.visibility === 'PUBLIC') {
    return NextResponse.redirect(`${targetOrigin}${returnTo}`)
  }

  // 4. Require better-auth session
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    const loginParams = new URLSearchParams({
      callbackApp: 'kb',
      kbId,
      returnTo,
    })
    return NextResponse.redirect(new URL(`/login?${loginParams.toString()}`, WEBAPP_URL))
  }

  // 5. Demo accounts blocked
  if (session.user.email.endsWith(`@${getDemoEmailDomain()}`)) {
    return NextResponse.redirect(new URL('/kb-auth/no-access?reason=demo', WEBAPP_URL))
  }

  // 6. Membership check
  const member = await isOrgMember(kb.organizationId, session.user.id)
  if (!member) {
    return NextResponse.redirect(new URL('/kb-auth/no-access', WEBAPP_URL))
  }

  // 7. Issue login token bound to the KB's origin
  const result = await issueLoginToken({
    userId: session.user.id,
    email: session.user.email,
    targetOrigin,
    issuerOrigin: WEBAPP_URL,
    returnTo,
  })

  if (result.isErr()) {
    return NextResponse.redirect(new URL('/kb-auth/no-access?reason=error', WEBAPP_URL))
  }

  const verifyUrl = new URL('/auth/verify', targetOrigin)
  verifyUrl.searchParams.set('loginToken', result.value.token)
  return NextResponse.redirect(verifyUrl)
}
