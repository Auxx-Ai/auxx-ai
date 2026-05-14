// packages/services/src/lambda-execution/invoke-lambda-executor-streaming.ts

/**
 * SPIKE: streaming-aware lambda invocation.
 *
 * Mirrors `invokeLambdaExecutor` but reads the response body as a chunked
 * SSE stream and forwards each event via `onEvent`. Used to verify that
 * AWS Lambda `RESPONSE_STREAM` mode delivers chunks on cadence end-to-end.
 *
 * See plans/kopilot/apps/lambda-streaming-spike.md
 */

import { INTERNAL_LAMBDA_URL } from '@auxx/config/server'
import { signInboundRequest } from '@auxx/credentials/lambda-auth'
import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'

export interface StreamEvent {
  event: string
  data: unknown
  /** Timestamp (ms) when this event was received by the caller — for cadence measurement */
  receivedAt: number
}

export interface StreamingInvocationResult {
  /** The terminal `result` event's data, if one was emitted */
  finalResult: unknown
  /** Total events received (including `result`) */
  eventCount: number
  /** Total wall-clock duration from fetch start to stream end */
  totalDurationMs: number
  /** Time from fetch start to first chunk arriving */
  ttfbMs: number
}

export interface StreamingInvocationError {
  code: string
  message: string
  statusCode: number
}

/**
 * Parse SSE frames (`event:`, `data:`) from a buffered string.
 * Returns parsed events and the leftover (incomplete) frame.
 */
function parseSseFrames(buffer: string): {
  events: Array<{ event: string; data: unknown }>
  leftover: string
} {
  const events: Array<{ event: string; data: unknown }> = []
  const frames = buffer.split('\n\n')
  const leftover = frames.pop() ?? ''

  for (const frame of frames) {
    if (!frame.trim()) continue
    let eventName = 'message'
    let dataLine = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
    }
    if (!dataLine) continue
    try {
      events.push({ event: eventName, data: JSON.parse(dataLine) })
    } catch {
      events.push({ event: eventName, data: dataLine })
    }
  }

  return { events, leftover }
}

export async function invokeLambdaExecutorStreaming(params: {
  payload: any
  caller: string
  /** Optional path on the lambda-server (default `/stream-probe` for the spike). */
  path?: string
  lambdaUrl?: string
  onEvent: (ev: StreamEvent) => void
}): Promise<Result<StreamingInvocationResult, StreamingInvocationError>> {
  const {
    payload,
    caller,
    path = '/stream-probe',
    lambdaUrl = INTERNAL_LAMBDA_URL,
    onEvent,
  } = params

  try {
    const body = JSON.stringify(payload)
    const secret = process.env.LAMBDA_INVOKE_SECRET
    const authHeaders = secret ? signInboundRequest({ body, caller, secret }) : {}

    // lambdaUrl may be `https://host` or `https://host/`; join cleanly with path
    const base = lambdaUrl.replace(/\/$/, '')
    const targetUrl = `${base}${path.startsWith('/') ? path : `/${path}`}`

    const startedAt = Date.now()
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders,
      },
      body,
    })

    if (!response.ok || !response.body) {
      return err({
        code: 'STREAM_INVOCATION_FAILED',
        message: `Lambda returned ${response.status}`,
        statusCode: response.status,
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let ttfbMs: number | null = null
    let eventCount = 0
    let finalResult: unknown = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (ttfbMs === null) ttfbMs = Date.now() - startedAt

      buffer += decoder.decode(value, { stream: true })
      const { events, leftover } = parseSseFrames(buffer)
      buffer = leftover

      for (const ev of events) {
        eventCount += 1
        const wrapped: StreamEvent = { ...ev, receivedAt: Date.now() }
        onEvent(wrapped)
        if (ev.event === 'result') finalResult = ev.data
      }
    }

    // Flush any trailing frame
    if (buffer.trim()) {
      const { events } = parseSseFrames(`${buffer}\n\n`)
      for (const ev of events) {
        eventCount += 1
        onEvent({ ...ev, receivedAt: Date.now() })
        if (ev.event === 'result') finalResult = ev.data
      }
    }

    return ok({
      finalResult,
      eventCount,
      totalDurationMs: Date.now() - startedAt,
      ttfbMs: ttfbMs ?? -1,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return err({
      code: 'STREAM_INVOCATION_ERROR',
      message: `Failed to stream from Lambda: ${message}`,
      statusCode: 500,
    })
  }
}
