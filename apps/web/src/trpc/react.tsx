// apps/web/src/trpc/react.tsx
'use client'

import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { loggerLink, unstable_httpBatchStreamLink } from '@trpc/client'
import { createTRPCReact } from '@trpc/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import { useState } from 'react'
import SuperJSON from 'superjson'
// import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import { getRealtimeSocketId } from '~/realtime/hooks'
import type { AppRouter } from '~/server/api/root'
import { createQueryClient } from './query-client'

let clientQueryClientSingleton: QueryClient | undefined

/**
 * Gets the query client singleton (browser) or creates a new one (server)
 * Exported for use in non-React contexts (e.g., Zustand stores, utilities)
 */
export const getQueryClient = () => {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return createQueryClient()
  }
  // Browser: use singleton pattern to keep the same query client
  return (clientQueryClientSingleton ??= createQueryClient())
}

export const api = createTRPCReact<AppRouter>()

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>

/** Read the extension embed bearer token injected by `/embed/*` pages. */
function getEmbedToken(): string | null {
  if (typeof window === 'undefined') return null
  if (!window.location.pathname.startsWith('/embed/')) return null
  return ((window as Window & { AUXX_EMBED_TOKEN?: string }).AUXX_EMBED_TOKEN ?? null) || null
}

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === 'development' ||
            (op.direction === 'down' && op.result instanceof Error),
        }),
        unstable_httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + '/api/trpc',
          headers: () => {
            const headers = new Headers()
            headers.set('x-trpc-source', 'nextjs-react')
            const socketId = getRealtimeSocketId()
            if (socketId) {
              headers.set('x-realtime-socket-id', socketId)
            }
            const embedToken = getEmbedToken()
            if (embedToken) {
              headers.set('authorization', `Bearer ${embedToken}`)
            }
            return headers
          },
        }),
      ],
    })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
      {/* <ReactQueryDevtools initialIsOpen={false} position="bottom-right" /> */}
      {/* <ReactQueryDevtools initialIsOpen={false} position="top-right" /> */}
      {/* <ReactQueryDevtools initialIsOpen={false} position="bottom-left" /> */}
      {/* <ReactQueryDevtools initialIsOpen={false} position="top-left" /> */}
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  )
}

/** Resolve the base URL for browser, deployed server, and local server contexts. */
function getBaseUrl() {
  if (typeof window !== 'undefined') return window.location.origin
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://localhost:${process.env.PORT ?? 3000}`
}
