// apps/build/src/trpc/server.ts
// Server-side tRPC helpers

import 'server-only'

import { createHydrationHelpers } from '@trpc/react-query/rsc'
import { headers } from 'next/headers'
import { cache } from 'react'

import { type AppRouter, createCaller } from '~/server/api/root'
import { createTRPCContext } from '~/server/api/trpc'
import { createQueryClient } from './query-client'

/**
 * Wraps createTRPCContext and provides required context for tRPC API
 * when handling a tRPC call from a React Server Component
 */
const createContext = cache(async () => {
  const heads = new Headers(await headers())
  heads.set('x-trpc-source', 'rsc')

  return createTRPCContext({
    req: {
      headers: heads,
    } as any,
  })
})

const getQueryClient = cache(createQueryClient)
const caller = createCaller(createContext)

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
  caller,
  getQueryClient
)
