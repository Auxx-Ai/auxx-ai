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
import { verifyInboundRequest } from './auth/verify-inbound.ts'
import { loadBundle } from './bundle-loader.ts'
import { createRuntimeContext } from './context-provider.ts'
import { executeAiToolStreaming } from './executors/ai-tool-executor.ts'
import { handler } from './index.ts'
import type { LambdaEvent } from './types.ts'
import { validateLambdaEvent } from './validator.ts'

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

  // Streaming AI tool endpoint — runs an AI tool's `execute()` and pipes its
  // AsyncGenerator yields out as SSE `event: progress` frames, terminating with
  // `event: result`. Same auth + validation pipeline as the buffered `/`
  // endpoint; only the response shape differs. See plans/kopilot/apps/README.md §6.2.
  if (url.pathname === '/ai-tool/stream' && req.method === 'POST') {
    return handleAiToolStreamingRequest(req)
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

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { message, code } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function handleAiToolStreamingRequest(req: Request): Promise<Response> {
  const rawBody = await req.text()
  if (rawBody.length > 5 * 1024 * 1024) {
    return jsonError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large')
  }

  // Auth — same gate as `handler()` in index.ts.
  const secret = Deno.env.get('LAMBDA_INVOKE_SECRET')
  let authCaller: string | undefined
  if (secret) {
    const headers: Record<string, string> = {}
    for (const [k, v] of req.headers.entries()) headers[k.toLowerCase()] = v
    const authResult = await verifyInboundRequest({ headers, body: rawBody, secret })
    console.log('[Lambda:Auth][stream]', {
      decision: authResult.valid ? 'accept' : 'reject',
      caller: authResult.caller,
      reason: authResult.reason,
    })
    if (!authResult.valid) {
      return jsonError(401, 'AUTH_FAILED', authResult.reason ?? 'Unauthorized')
    }
    authCaller = authResult.caller
  } else if (Deno.env.get('NODE_ENV') !== 'development') {
    return jsonError(500, 'AUTH_CONFIG_ERROR', 'Auth not configured')
  }

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Body is not valid JSON')
  }

  const validation = validateLambdaEvent(event)
  if (!validation.success) {
    return jsonError(400, 'VALIDATION_ERROR', 'Validation failed')
  }

  const validated = validation.data
  if (validated.type !== 'ai-tool') {
    return jsonError(400, 'WRONG_EVENT_TYPE', `/ai-tool/stream only accepts 'ai-tool' events`)
  }

  // Mirror the caller-allowlist check in index.ts — only `kopilot` may invoke AI tools.
  if (authCaller && authCaller !== 'kopilot') {
    return jsonError(403, 'CALLER_TYPE_DENIED', `Caller "${authCaller}" cannot invoke 'ai-tool'`)
  }

  const { context: execCtx, serverBundleSha, ...rest } = validated
  const bundleCode = await loadBundle(execCtx.appId, serverBundleSha)
  const runtimeContext = createRuntimeContext(execCtx)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeFrame = (eventName: string, data: unknown) => {
        const chunk = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(chunk))
      }

      try {
        const gen = executeAiToolStreaming({ ...rest, bundleCode, context: runtimeContext })
        let finalResult: unknown = null
        while (true) {
          const next = await gen.next()
          if (next.done) {
            finalResult = next.value
            break
          }
          writeFrame('progress', next.value)
        }
        writeFrame('result', finalResult)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeFrame('error', {
          message,
          code: error instanceof Error ? (error as { code?: string }).code : undefined,
        })
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

// Start HTTP server — bind to 0.0.0.0 for container networking
await serve(handleRequest, { port: PORT, hostname: '0.0.0.0' })
