// apps/web/src/proxy.ts

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Route prefixes that must NOT be treated as org handles.
 * This is intentionally a self-contained set (no external imports) because
 * the proxy runs on the Edge runtime where package imports can fail.
 *
 * The full reserved handle list lives in @auxx/config RESERVED_ORGANIZATION_HANDLES
 * and is enforced at org creation time — this set only needs the actual URL
 * segments that exist in the app router.
 */
const KNOWN_ROUTE_PREFIXES = new Set([
  // (protected) routes
  'app',
  'onboarding',
  'organizations',
  'preview',
  'subscription',
  // (auth) routes
  'change-password',
  'consent',
  'deactivated',
  'demo',
  'demo-expired',
  'forgot-password',
  'login',
  'reset-password',
  'signup',
  'two-factor',
  // (public) routes
  'accept-invitation',
  'workflows',
  // Top-level routes
  'admin',
  'api',
  'context',
  'embed',
  'health',
  'kb',
  'ph',
  'setup',
  // Next.js metadata routes (file-based, no extension in URL)
  'icon',
  'apple-icon',
  // Next.js / infra
  '_next',
  'trpc',
])

/**
 * Top-level origins where the extension injects the outer panel iframe.
 * `frame-ancestors` checks the full ancestor chain, so the leaf embed must
 * allow both the immediate chrome-extension iframe and the host page that
 * contains that extension iframe.
 */
const EXTENSION_HOST_FRAME_ANCESTORS = [
  'https://mail.google.com',
  'https://www.linkedin.com',
  'https://twitter.com',
  'https://x.com',
  'https://www.facebook.com',
  'https://www.instagram.com',
  'http://localhost:*',
  'http://127.0.0.1:*',
]

/**
 * Allowed `frame-ancestors` for the extension's embed iframe. CSP doesn't
 * allow wildcards on the chrome-extension scheme, so each allowed extension
 * ID is listed explicitly. `NEXT_PUBLIC_EXTENSION_ID` is comma-separated so
 * the Web Store ID and a local unpacked dev ID can coexist.
 */
const EXTENSION_IDS = (process.env.NEXT_PUBLIC_EXTENSION_ID ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
const EMBED_FRAME_ANCESTORS =
  EXTENSION_IDS.length > 0
    ? [
        ...EXTENSION_IDS.map((id) => `chrome-extension://${id}`),
        ...EXTENSION_HOST_FRAME_ANCESTORS,
      ].join(' ')
    : ''

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  // CSP for the extension embed iframe — allow the full nested ancestor
  // chain: supported host page -> chrome-extension panel -> embed page.
  if (pathname.startsWith('/embed/') && EMBED_FRAME_ANCESTORS) {
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', `frame-ancestors ${EMBED_FRAME_ANCESTORS};`)
    return response
  }

  // Org handle deep link detection:
  // If the first path segment is not a known route, treat it as an org handle.
  // Sets a short-lived cookie and redirects to the remaining path so the
  // client-side hook can trigger the org switch without a server mutation.
  const segments = pathname.split('/')
  const firstSegment = segments[1]

  if (firstSegment && !KNOWN_ROUTE_PREFIXES.has(firstSegment)) {
    const remainingPath = segments.slice(2).join('/')
    const targetPath = remainingPath ? `/${remainingPath}` : '/app'

    // Validate redirect target to prevent open redirects
    if (targetPath.startsWith('//') || targetPath.includes('..')) {
      return NextResponse.redirect(new URL('/app', req.url))
    }

    const redirectUrl = new URL(targetPath + search, req.url)
    const response = NextResponse.redirect(redirectUrl)

    // Cookie for client-side org switch hook (short-lived)
    response.cookies.set('auxx-org-handle', firstSegment, {
      maxAge: 60,
      path: '/',
      httpOnly: false, // client JS needs to read this
      sameSite: 'lax',
    })

    // Cookie to preserve the full deep link path through the login flow.
    // If the user is unauthenticated, the protected layout reads this and
    // passes it as callbackUrl to /login. After login the user hits the
    // deep link again and the proxy sets a fresh handle cookie.
    response.cookies.set('auxx-org-deep-link', pathname + search, {
      maxAge: 300, // 5 minutes — enough to complete login
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
    })

    return response
  }
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|ogg)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
