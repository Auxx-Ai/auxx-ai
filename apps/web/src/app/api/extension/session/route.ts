// apps/web/src/app/api/extension/session/route.ts

import { configService } from '@auxx/credentials'
import { DehydrationService } from '@auxx/lib/dehydration'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

/**
 * Session + dehydrated state lookup for the Auxx Chrome extension iframe.
 *
 * The iframe runs on `chrome-extension://<id>` and can't participate in
 * OAuth/passkey/2FA/captcha — so authentication always happens on auxx.ai.
 * After the user signs in there the session cookie rides back via CORS,
 * and this endpoint is what the iframe calls to ask "am I signed in, and
 * what's my state?".
 *
 * On success we return the same `DehydratedState` the web app uses so the
 * iframe can render user/org info (name, handle, active org id, ...) off
 * the Redis-backed cache. Called once per iframe mount — not on a timer.
 */

const EXTENSION_ORIGINS = new Set(
  (configService.get<string>('NEXT_PUBLIC_EXTENSION_ID') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => `chrome-extension://${id}`)
)

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !EXTENSION_ORIGINS.has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export async function GET(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('origin'))
  const session = await auth.api.getSession({ headers: request.headers })

  if (!session?.user) {
    return NextResponse.json({ signedIn: false as const }, { status: 200, headers })
  }

  const dehydrationService = new DehydrationService()
  const state = await dehydrationService.getState(session.user.id)

  return NextResponse.json({ signedIn: true as const, state }, { status: 200, headers })
}

export function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  })
}
