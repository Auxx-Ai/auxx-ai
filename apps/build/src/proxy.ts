// apps/build/src/proxy.ts

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { WEBAPP_URL } from '@auxx/config/urls'

/**
 * Proxy to protect routes and redirect to login
 */
export async function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get('better-auth.session_token')

  // Public paths that don't require authentication
  const publicPaths = ['/api/auth']
  const isPublicPath = publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))

  if (isPublicPath) {
    return NextResponse.next()
  }

  // If no session cookie, redirect to login
  if (!sessionCookie) {
    const callbackUrl = request.url
    const loginUrl = `${WEBAPP_URL}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
    return NextResponse.redirect(loginUrl)
  }

  // Validate session with apps/web
  try {
    const response = await fetch(`${WEBAPP_URL}/api/auth/session`, {
      headers: {
        Cookie: `better-auth.session_token=${sessionCookie.value}`,
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const callbackUrl = request.url
      const loginUrl = `${WEBAPP_URL}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
      return NextResponse.redirect(loginUrl)
    }

    return NextResponse.next()
  } catch (error) {
    console.error('Session validation failed:', error)

    const callbackUrl = request.url
    const loginUrl = `${WEBAPP_URL}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
    return NextResponse.redirect(loginUrl)
  }
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
