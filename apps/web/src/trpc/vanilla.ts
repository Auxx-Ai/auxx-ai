// apps/web/src/trpc/vanilla.ts

import { createTRPCClient, httpBatchLink } from '@trpc/client'
import SuperJSON from 'superjson'
import { getRealtimeSocketId } from '~/realtime/hooks'
import type { AppRouter } from '~/server/api/root'

/**
 * Resolve the tRPC base URL.
 *
 * Must NOT use `WEBAPP_URL` from `@auxx/config`: that constant is resolved from
 * `process.env.APP_URL` / `process.env.DOMAIN` through a *dynamic* `process.env[key]`
 * read, which the Next bundler cannot inline (only `NEXT_PUBLIC_*` reaches the
 * browser). In a browser bundle both reads return undefined and `WEBAPP_URL`
 * silently collapses to its `http://localhost:3000` dev fallback — harmless
 * locally, a hard "Failed to fetch" in production. Same origin as the page is
 * both correct and what the React client (`~/trpc/react`) already uses.
 */
function getBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin
  return `http://localhost:${process.env.PORT ?? 3000}`
}

/**
 * Vanilla (non-React) tRPC client for use outside React lifecycle.
 * Shares session cookie with the React client (same origin).
 * Use this for module-level completion handlers that survive component unmount.
 *
 * Sends the realtime socket ID header so the backend can exclude the originator
 * from its own realtime echoes — matches the behavior of the React tRPC client.
 */
export const vanillaApi = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: SuperJSON,
      url: `${getBaseUrl()}/api/trpc`,
      headers: () => {
        const headers: Record<string, string> = {
          'x-trpc-source': 'nextjs-vanilla',
        }
        const socketId = getRealtimeSocketId()
        if (socketId) {
          headers['x-realtime-socket-id'] = socketId
        }
        return headers
      },
    }),
  ],
})
