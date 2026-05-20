// packages/services/src/lambda-execution/invoke-lambda-executor-streaming.ts

/**
 * Streaming-aware lambda invocation. Mirrors `invokeLambdaExecutor` but reads
 * the response body as a chunked SSE stream and forwards each event via
 * `onEvent`. Default target is `/tool/stream` on the lambda-server (Railway
 * `lambda-server` container) — see plans/kopilot/apps/README.md §6.2.
 *
 * Wire format (per the lambda-server's streaming endpoint):
 *   event: progress  → tool emitted a `ToolProgressPayload` yield
 *   event: result    → tool returned its final value (terminal frame)
 *   event: error     → tool threw before completing
 *
 * The Kopilot apps bridge wraps this caller to expose progress events as
 * `tool-progress` agent events on the SSE channel.
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
  /** Optional path on the lambda-server (default `/tool/stream`). */
  path?: string
  lambdaUrl?: string
  onEvent: (ev: StreamEvent) => void
}): Promise<Result<StreamingInvocationResult, StreamingInvocationError>> {
  const {
    payload,
    caller,
    path = '/tool/stream',
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
    let streamError: { message?: string; code?: string } | null = null

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
        if (ev.event === 'error' && ev.data && typeof ev.data === 'object') {
          streamError = ev.data as { message?: string; code?: string }
        }
      }
    }

    // Flush any trailing frame
    if (buffer.trim()) {
      const { events } = parseSseFrames(`${buffer}\n\n`)
      for (const ev of events) {
        eventCount += 1
        onEvent({ ...ev, receivedAt: Date.now() })
        if (ev.event === 'result') finalResult = ev.data
        if (ev.event === 'error' && ev.data && typeof ev.data === 'object') {
          streamError = ev.data as { message?: string; code?: string }
        }
      }
    }

    // Map mid-stream `event: error` frames into a typed error result so the
    // bridge surfaces them the same way buffered `invokeLambdaExecutor` does.
    if (streamError) {
      const code = streamError.code ?? 'EXECUTION_ERROR'
      const message = streamError.message ?? 'Streaming AI tool failed'
      const isConnectionError = code === 'CONNECTION_NOT_FOUND' || code === 'CONNECTION_EXPIRED'
      return err({
        code: isConnectionError ? 'CONNECTION_REQUIRED' : code,
        message,
        statusCode: isConnectionError ? 403 : 500,
      })
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
