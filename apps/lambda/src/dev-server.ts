// apps/lambda/src/dev-server.ts

/**
 * Development HTTP server for local Lambda testing.
 *
 * This runs the same execution logic as production Lambda,
 * but wrapped in a simple HTTP server for local development.
 *
 * Usage:
 *   docker compose up -d
 *   curl -XPOST http://localhost:3008 -d '{...}'
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { handler } from './index.ts'
import type { LambdaEvent } from './types.ts'

const PORT = parseInt(Deno.env.get('PORT') || '3008', 10)

console.log(`[DevServer] Starting on port ${PORT}`)
console.log(`[DevServer] Environment: ${Deno.env.get('NODE_ENV')}`)
console.log(`[DevServer] Bundles path: ${Deno.env.get('LOCAL_BUNDLES_PATH')}`)

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  // Health check endpoint
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', port: PORT }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Main execution endpoint
  if (url.pathname === '/' && req.method === 'POST') {
    try {
      const event = (await req.json()) as unknown as LambdaEvent

      console.log('[DevServer] Received request:', {
        type: event.type,
        ...('functionIdentifier' in event && { functionIdentifier: event.functionIdentifier }),
        ...('bundleKey' in event && { bundleKey: event.bundleKey }),
      })

      // Call the same handler as Lambda
      const response = await handler(event)

      return new Response(response.body, {
        status: response.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // CORS for local dev
        },
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : ''
      const stack = error instanceof Error ? error.stack : ''
      console.error('[DevServer] Error:', error)
      return new Response(
        JSON.stringify({
          error: {
            message,
            code: 'DEV_SERVER_ERROR',
            stack,
          },
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  }

  // 404 for other paths
  return new Response('Not Found', { status: 404 })
}

// Start HTTP server
await serve(handleRequest, { port: PORT })
