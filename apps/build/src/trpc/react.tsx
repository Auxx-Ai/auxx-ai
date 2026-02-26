// apps/build/src/trpc/react.tsx
// tRPC React client for developer portal

'use client'

import { DEV_PORTAL_URL } from '@auxx/config/urls'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchStreamLink, loggerLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import type { inferRouterOutputs } from '@trpc/server'

import { useState } from 'react'
import SuperJSON from 'superjson'
import type { AppRouter } from '~/server/api/root'
import { createQueryClient } from './query-client'

/** tRPC React client */
export const api = createTRPCReact<AppRouter>()

/** Get or create query client singleton */
let clientQueryClientSingleton: QueryClient | undefined
const getQueryClient = () => {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return createQueryClient()
  }
  // Browser: use singleton pattern to keep the same query client
  return (clientQueryClientSingleton ??= createQueryClient())
}

/** Get base URL for tRPC */
function getBaseUrl() {
  if (typeof window !== 'undefined') return window.location.origin
  return DEV_PORTAL_URL
}

/** tRPC React provider component */
export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + '/api/trpc',
          headers: () => {
            const headers = new Headers()
            headers.set('x-trpc-source', 'nextjs-react')
            return headers
          },
        }),
      ],
    })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </api.Provider>
    </QueryClientProvider>
  )
}

export type RouterOutputs = inferRouterOutputs<AppRouter>
