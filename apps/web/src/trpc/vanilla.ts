// apps/web/src/trpc/vanilla.ts

import { WEBAPP_URL } from '@auxx/config/client'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import SuperJSON from 'superjson'
import type { AppRouter } from '~/server/api/root'

/**
 * Vanilla (non-React) tRPC client for use outside React lifecycle.
 * Shares session cookie with the React client (same origin).
 * Use this for module-level completion handlers that survive component unmount.
 */
export const vanillaApi = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: SuperJSON,
      url: `${WEBAPP_URL}/api/trpc`,
      headers: () => ({
        'x-trpc-source': 'nextjs-vanilla',
      }),
    }),
  ],
})
