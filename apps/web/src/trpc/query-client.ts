// apps/web/src/trpc/query-client.ts

import { defaultShouldDehydrateQuery, MutationCache, QueryClient } from '@tanstack/react-query'
import posthog from 'posthog-js'
import SuperJSON from 'superjson'

/**
 * staleTime for org-static queries (installed apps, AI model catalog, …) that
 * change only through explicit admin mutations, all of which invalidate the
 * query locally. Capped at 5 min: these lists have no realtime invalidation,
 * so a change made by ANOTHER admin or tab stays invisible for this window —
 * a non-stale query also skips the window-focus refetch.
 */
export const ORG_STATIC_STALE_TIME = 5 * 60 * 1000

/**
 * tRPC error code → HTTP status, for the fallback path only. `data.httpStatus`
 * is present on anything that came back over the HTTP link; this covers the
 * shapes that didn't (a server-side caller, a hand-thrown `TRPCError`), where
 * `httpStatus` is absent and the code is all we have.
 */
const CODE_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  PARSE_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  TIMEOUT: 408,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
}

/**
 * Resolve a tRPC client error to an HTTP status, or `undefined` when it isn't
 * one (a network failure, an aborted fetch) — those keep retrying.
 */
export function errorStatus(error: unknown): number | undefined {
  const data = (error as { data?: { httpStatus?: unknown; code?: unknown } } | undefined)?.data
  if (typeof data?.httpStatus === 'number') return data.httpStatus
  if (typeof data?.code === 'string') return CODE_STATUS[data.code]
  return undefined
}

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
        retry: (failureCount, error) => {
          const status = errorStatus(error)
          // Every 4xx is the server's considered answer, not a blip — asking a
          // fourth time produces the same refusal. This used to exempt 401/403
          // only, which meant a NOT_FOUND cost 4 round trips per trigger: mail
          // answers a lens denial with 404 (it hides existence rather than
          // admitting a thread it won't show), so a revoked thread left open
          // hammered `message.listByThread` on every focus and reconnect.
          // 408 and 429 are the two that genuinely mean "try again".
          if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
            return false
          }
          return failureCount < 3
        },
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
