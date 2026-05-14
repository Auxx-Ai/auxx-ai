// apps/web/src/app/api/kopilot/_spike-stream/route.ts

/**
 * SPIKE: Lambda response-streaming end-to-end test route.
 *
 * Calls the lambda `streaming-probe` handler via `invokeLambdaExecutorStreaming`
 * and forwards each event as SSE to the browser. Used to verify that AWS
 * Lambda `RESPONSE_STREAM` mode delivers chunks on cadence (not buffered) all
 * the way through Function URL → Node fetch → Next.js SSE → browser.
 *
 * Delete this route once the spike verdict is in.
 * See plans/kopilot/apps/lambda-streaming-spike.md
 */

import { invokeLambdaExecutorStreaming } from '@auxx/services/lambda-execution'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Spike route disabled in production', { status: 404 })
  }

  let body: { steps?: number; intervalMs?: number } = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine — use defaults
  }

  const encoder = new TextEncoder()
  const startedAt = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // ignore — controller might be closed
        }
      }

      send('spike-start', { startedAt, payload: body })

      const result = await invokeLambdaExecutorStreaming({
        payload: { type: 'streaming-probe', steps: body.steps, intervalMs: body.intervalMs },
        caller: 'kopilot-spike',
        onEvent: (ev) => {
          send('lambda-event', {
            event: ev.event,
            data: ev.data,
            forwardedAt: Date.now(),
            elapsedSinceStart: Date.now() - startedAt,
          })
        },
      })

      if (result.isErr()) {
        send('spike-error', { error: result.error })
      } else {
        send('spike-complete', {
          ttfbMs: result.value.ttfbMs,
          totalDurationMs: result.value.totalDurationMs,
          eventCount: result.value.eventCount,
          finalResult: result.value.finalResult,
        })
      }

      try {
        controller.close()
      } catch {
        // already closed
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

export async function GET() {
  return new Response(
    'POST { "steps"?: number, "intervalMs"?: number } to this route to run the lambda streaming spike. See plans/kopilot/apps/lambda-streaming-spike.md',
    { status: 200, headers: { 'Content-Type': 'text/plain' } }
  )
}
