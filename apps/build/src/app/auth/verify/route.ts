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

  // 1. Verify token signature and claims (aud, exp, iss)
  const result = await verifyLoginToken(loginToken, DEV_PORTAL_URL)
  if (result.isErr()) {
    return NextResponse.redirect(`${WEBAPP_URL}/login?callbackApp=build&returnTo=/`)
  }

  const { userId, email, returnTo, jti } = result.value

  // 2. Consume jti (single-use check via Redis)
  const consumed = await consumeLoginTokenJti(jti)
  if (!consumed) {
    return NextResponse.redirect(`${WEBAPP_URL}/login?callbackApp=build&returnTo=/`)
  }

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

  return response
}
