import { defaultShouldDehydrateQuery, MutationCache, QueryClient } from '@tanstack/react-query'
import posthog from 'posthog-js'
import SuperJSON from 'superjson'

export const createQueryClient = () =>
  new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!posthog.__loaded) return

        const path = (mutation.options.mutationKey as string[] | undefined)?.join('.') ?? 'unknown'
        const data = (error as any)?.data
        const code = data?.code ?? data?.httpStatus ?? undefined

        posthog.capture('trpc_error', {
          path,
          message: error.message,
          code,
        })
      },
    }),
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  })
