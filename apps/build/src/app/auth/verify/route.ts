// apps/build/src/app/auth/verify/route.ts

import { DEV_PORTAL_URL, WEBAPP_URL } from '@auxx/config/urls'
import { configService } from '@auxx/credentials'
import { verifyLoginToken } from '@auxx/credentials/login-token'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { consumeLoginTokenJti, createLocalSession } from '~/lib/auth'

const SESSION_COOKIE_NAME = 'auxx-build.session'

export async function GET(request: NextRequest) {
  const loginToken = request.nextUrl.searchParams.get('loginToken')

  if (!loginToken) {
    return NextResponse.redirect(`${DEV_PORTAL_URL}/`)
  }

  // Debug: log key format and resolved URLs on first request
  const pubKey = configService.get<string>('LOGIN_TOKEN_PUBLIC_KEY')
  const hasLiteralBackslashN = pubKey?.includes('\\n') ?? false
  const hasRealNewline = pubKey?.includes('\n') ?? false
  console.log('[auth/verify] DEV_PORTAL_URL:', DEV_PORTAL_URL)
  console.log('[auth/verify] WEBAPP_URL:', WEBAPP_URL)
  console.log('[auth/verify] LOGIN_TOKEN_PUBLIC_KEY present:', !!pubKey)
  console.log('[auth/verify] Key has literal \\n:', hasLiteralBackslashN)
  console.log('[auth/verify] Key has real newlines:', hasRealNewline)
  console.log('[auth/verify] Key length:', pubKey?.length ?? 0)
  console.log(
    '[auth/verify] BUILD_SESSION_SECRET present:',
    !!configService.get<string>('BUILD_SESSION_SECRET')
  )

  // 1. Verify token signature and claims (aud, exp, iss)
  const result = await verifyLoginToken(loginToken, DEV_PORTAL_URL)
  if (result.isErr()) {
    console.error('[auth/verify] Token verification failed:', result.error)
    return NextResponse.redirect(`${WEBAPP_URL}/login?callbackApp=build&returnTo=/`)
  }

  console.log('[auth/verify] Token verified for user:', result.value.userId)

  const { userId, email, returnTo, jti } = result.value

  // 2. Consume jti (single-use check via Redis)
  const consumed = await consumeLoginTokenJti(jti)
  if (!consumed) {
    console.error('[auth/verify] JTI consumption failed (Redis unavailable or token already used)')
    return NextResponse.redirect(`${WEBAPP_URL}/login?callbackApp=build&returnTo=/`)
  }

  console.log('[auth/verify] JTI consumed, creating session')

  // 3. Create local session cookie
  const sessionCookie = await createLocalSession({ userId, email })

  // 4. Set cookie and 303 redirect to clean URL
  const isDev = configService.get<string>('NODE_ENV') === 'development'
  const response = NextResponse.redirect(new URL(returnTo, DEV_PORTAL_URL), { status: 303 })
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    maxAge: 60 * 60, // 1 hour
    path: '/',
  })

  console.log('[auth/verify] Session cookie set, redirecting to:', returnTo)
  return response
}
