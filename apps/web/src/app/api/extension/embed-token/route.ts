// apps/web/src/app/api/extension/embed-token/route.ts

import { configService } from '@auxx/credentials'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

/**
 * Mints a short-lived bearer token for the extension's embed iframe.
 *
 * The extension iframe at `chrome-extension://<id>` already proves it can
 * authenticate via `/api/extension/session` — cookies ride via CORS on
 * fetch. This endpoint extracts the user's signed session-token cookie
 * and returns its raw value as a bearer token. The embed page then
 * exchanges that token for a partitioned session cookie via the
 * `Authorization: Bearer` header (handled by better-auth's `bearer()`
 * plugin in `apps/web/src/auth/server.ts`).
 *
 * The token is just the existing session-token cookie value — the bearer
 * plugin accepts the signed `<token>.<signature>` format directly. We
 * don't mint a separate short-lived token because the bearer plugin
 * verifies the HMAC and the underlying session row, which is enough to
 * gate the iframe load. The token is exposed only to the extension origin
 * via CORS, then handed off through a URL query param consumed once.
 */

const EXTENSION_ID = configService.get<string>('NEXT_PUBLIC_EXTENSION_ID') ?? ''
const EXTENSION_ORIGIN = EXTENSION_ID ? `chrome-extension://${EXTENSION_ID}` : null

const SECURE_COOKIE_PREFIX = '__Secure-'
const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  `${SECURE_COOKIE_PREFIX}better-auth.session_token`,
]

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || origin !== EXTENSION_ORIGIN) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

/**
 * Pull the session-token cookie value from the wire `Cookie:` header.
 * Returns the raw (still URL-encoded) value, which the better-auth bearer
 * plugin accepts directly via `Authorization: Bearer <value>`.
 */
function readSessionCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const name = part.slice(0, idx).trim()
    const value = part.slice(idx + 1)
    if (SESSION_COOKIE_NAMES.includes(name) && value) {
      return value
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get('origin'))

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ ok: false as const }, { status: 401, headers })
  }

  const cookieHeader = request.headers.get('cookie') ?? ''
  const token = readSessionCookie(cookieHeader)
  if (!token) {
    return NextResponse.json({ ok: false as const }, { status: 401, headers })
  }

  return NextResponse.json({ ok: true as const, token }, { status: 200, headers })
}

export function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  })
}
