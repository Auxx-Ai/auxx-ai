// apps/web/src/auth/session.ts

import 'server-only'

import { headers } from 'next/headers'
import { cache } from 'react'
import { auth } from '~/auth/server'

/**
 * Request-memoized session lookup for server components and route handlers.
 *
 * Layouts, pages, and the tRPC RSC context all resolve the session during the
 * same request; each `auth.api.getSession` call re-runs the `customSession`
 * callback (Redis round-trips), so without memoization one page render pays
 * for the same session 3-4 times. React `cache()` collapses them into one
 * lookup per request. Outside a React request scope it degrades to a plain
 * uncached call, so route handlers can use it too.
 *
 * Always prefer this over calling `auth.api.getSession` directly when the
 * incoming request's own headers are the auth source. Only call
 * `auth.api.getSession` directly when authenticating with constructed headers
 * (e.g. the embed iframe flow).
 */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }))
