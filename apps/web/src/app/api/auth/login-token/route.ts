// apps/web/src/app/api/auth/login-token/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { issueLoginToken } from '@auxx/credentials/login-token'
import { getDemoEmailDomain } from '@auxx/lib/demo'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '~/auth/server'
import { getTrustedAppOrigin } from '~/auth/trusted-apps'

export async function POST(request: NextRequest) {
  // 1. Verify the user has a valid session
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse and validate request body
  const body = await request.json()
  const { callbackApp, returnTo } = body

  if (!callbackApp || typeof callbackApp !== 'string') {
    return NextResponse.json({ error: 'Missing callbackApp' }, { status: 400 })
  }

  // Block demo users from accessing the developer portal
  if (callbackApp === 'build' && session.user.email.endsWith(`@${getDemoEmailDomain()}`)) {
    return NextResponse.json(
      { error: 'Demo accounts cannot access the developer portal' },
      { status: 403 }
    )
  }

  // 3. Resolve app ID to origin
  const targetOrigin = getTrustedAppOrigin(callbackApp)
  if (!targetOrigin) {
    return NextResponse.json({ error: 'Unknown app' }, { status: 400 })
  }

  // 4. Validate returnTo is a safe relative path
  const safePath = sanitizeReturnTo(returnTo)

  // 5. Issue login token
  const result = await issueLoginToken({
    userId: session.user.id,
    email: session.user.email,
    targetOrigin,
    issuerOrigin: WEBAPP_URL,
    returnTo: safePath,
  })

  if (result.isErr()) {
    return NextResponse.json({ error: result.error.message }, { status: 500 })
  }

  return NextResponse.json({
    loginToken: result.value.token,
    redirectUrl: `${targetOrigin}/auth/verify?loginToken=${result.value.token}`,
  })
}

function sanitizeReturnTo(returnTo: unknown): string {
  if (typeof returnTo !== 'string') return '/'
  // Must start with /, no protocol, no //, no ..
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('..')) {
    return '/'
  }
  return returnTo
}
