// apps/web/src/trpc/vanilla.ts

import { WEBAPP_URL } from '@auxx/config/client'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import SuperJSON from 'superjson'
import { getRealtimeSocketId } from '~/realtime/hooks'
import type { AppRouter } from '~/server/api/root'

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
      url: `${WEBAPP_URL}/api/trpc`,
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
