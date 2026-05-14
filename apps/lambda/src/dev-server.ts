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
import { streamingProbe } from './test-handlers/streaming-probe.ts'
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

  // SPIKE: streaming response probe — yields SSE events for cadence testing.
  // See plans/kopilot/apps/lambda-streaming-spike.md
  if (url.pathname === '/stream-probe' && req.method === 'POST') {
    let opts: { steps?: number; intervalMs?: number } = {}
    try {
      const text = await req.text()
      if (text) opts = JSON.parse(text)
    } catch {
      // empty/invalid body → defaults
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of streamingProbe(opts)) {
            const chunk = `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`
            controller.enqueue(encoder.encode(chunk))
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // Main execution endpoint
  if (url.pathname === '/' && req.method === 'POST') {
    try {
      const rawBody = await req.text()
      const event = JSON.parse(rawBody) as unknown as LambdaEvent

      // Extract request headers for auth verification
      const headers: Record<string, string> = {}
      for (const [k, v] of req.headers.entries()) {
        headers[k.toLowerCase()] = v
      }

      console.log('[DevServer] Received request:', {
        type: event.type,
        ...('functionIdentifier' in event && { functionIdentifier: event.functionIdentifier }),
        ...('serverBundleSha' in event && { serverBundleSha: event.serverBundleSha }),
      })

      // Call the same handler as Lambda, with auth metadata
      const response = await handler(event, { headers, rawBody })

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

// Start HTTP server — bind to 0.0.0.0 for container networking
await serve(handleRequest, { port: PORT, hostname: '0.0.0.0' })
