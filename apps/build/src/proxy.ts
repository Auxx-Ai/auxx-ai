// apps/build/src/proxy.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { verifyLocalSession } from '~/lib/auth'

/** Public paths that don't require authentication */
const PUBLIC_PATHS = ['/api/auth', '/auth/verify', '/health']

/**
 * Middleware to protect routes using local session verification.
 * No server-to-server call — JWT signature check is ~0.1ms.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip auth for public paths
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path))
  if (isPublicPath) {
    return NextResponse.next()
  }

  // Check local session cookie
  const sessionCookie = request.cookies.get('auxx-build.session')
  if (sessionCookie?.value) {
    const session = await verifyLocalSession(sessionCookie.value)
    if (session) {
      return NextResponse.next()
    }
  }

  // No valid session → redirect to central login
  const returnTo = pathname + request.nextUrl.search
  const loginUrl = `${WEBAPP_URL}/login?callbackApp=build&returnTo=${encodeURIComponent(returnTo)}`
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
