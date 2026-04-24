// apps/web/src/app/api/trpc/[trpc]/route.ts

import { configService } from '@auxx/credentials'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import type { NextRequest } from 'next/server'
import { appRouter } from '~/server/api/root'
import { createTRPCContext } from '~/server/api/trpc'

const EXTENSION_ID = configService.get<string>('NEXT_PUBLIC_EXTENSION_ID') ?? ''
const EXTENSION_ORIGIN = EXTENSION_ID ? `chrome-extension://${EXTENSION_ID}` : null

/** Headers that allow the Auxx Chrome extension to call tRPC with credentials. */
function buildCorsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  if (origin !== EXTENSION_ORIGIN) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-trpc-source',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  return createTRPCContext({ headers: req.headers })
}

const handler = async (req: NextRequest) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'))

  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError:
      configService.get<string>('NODE_ENV') === 'development'
        ? ({ path, error }) => {
            console.error(`❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`)
          }
        : undefined,
  })

  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value)
  }
  return response
}

const optionsHandler = (req: NextRequest) => {
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'))
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  })
}

export { handler as GET, handler as POST, optionsHandler as OPTIONS }
