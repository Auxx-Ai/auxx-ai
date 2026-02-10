// apps/lambda/src/lambda-runtime.ts

/**
 * Custom Lambda Runtime for Deno on provided.al2023
 *
 * Implements the Lambda Runtime API loop:
 * 1. Poll for next invocation
 * 2. Normalize Function URL envelope → internal payload
 * 3. Call handler()
 * 4. Post response back to Runtime API
 *
 * @see https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html
 */

import { handler } from './index.ts'

/** Lambda Runtime API base URL (provided by Lambda environment) */
const RUNTIME_API = Deno.env.get('AWS_LAMBDA_RUNTIME_API')

if (!RUNTIME_API) {
  console.error('[Runtime] AWS_LAMBDA_RUNTIME_API not set')
  Deno.exit(1)
}

const BASE = `http://${RUNTIME_API}/2018-06-01`

/**
 * Detect if the event is a Function URL envelope (API Gateway v2 format)
 */
function isFunctionUrlEvent(event: unknown): event is {
  version: string
  requestContext: { http: unknown }
  body?: string | null
  isBase64Encoded?: boolean
} {
  if (typeof event !== 'object' || event === null) return false
  const e = event as Record<string, unknown>
  return (
    e.version === '2.0' &&
    typeof e.requestContext === 'object' &&
    e.requestContext !== null &&
    'http' in (e.requestContext as Record<string, unknown>)
  )
}

/**
 * Extract the internal payload from a Lambda event.
 * - Function URL envelope: parse body as JSON
 * - Direct invocation: pass through as-is
 */
function extractPayload(event: unknown): { payload: unknown; fromFunctionUrl: boolean } {
  if (!isFunctionUrlEvent(event)) {
    return { payload: event, fromFunctionUrl: false }
  }

  let body = event.body ?? ''

  // Decode base64 if needed
  if (event.isBase64Encoded && typeof body === 'string') {
    body = atob(body)
  }

  // Parse JSON body
  if (typeof body === 'string') {
    try {
      return { payload: JSON.parse(body), fromFunctionUrl: true }
    } catch {
      return {
        payload: { __parseError: true, message: 'Invalid JSON in request body' },
        fromFunctionUrl: true,
      }
    }
  }

  return { payload: body, fromFunctionUrl: true }
}

/**
 * Format handler response for Function URL (HTTP response shape)
 */
function formatFunctionUrlResponse(response: { statusCode: number; body: string }): string {
  return JSON.stringify({
    statusCode: response.statusCode,
    headers: { 'content-type': 'application/json' },
    body: response.body,
  })
}

/**
 * Main runtime loop - runs indefinitely processing invocations
 */
async function runtimeLoop(): Promise<never> {
  console.log('[Runtime] Deno custom runtime started')

  while (true) {
    // 1. Poll for next invocation
    const next = await fetch(`${BASE}/runtime/invocation/next`)
    const requestId = next.headers.get('lambda-runtime-aws-request-id') ?? 'unknown'
    const rawEvent = await next.json()

    try {
      // 2. Extract internal payload
      const { payload, fromFunctionUrl } = extractPayload(rawEvent)

      // Handle JSON parse errors from Function URL
      if (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).__parseError
      ) {
        const errorResponse = {
          statusCode: 400,
          body: JSON.stringify({
            error: {
              message: (payload as Record<string, unknown>).message,
              code: 'INVALID_JSON',
            },
          }),
        }

        const responseBody = fromFunctionUrl
          ? formatFunctionUrlResponse(errorResponse)
          : JSON.stringify(errorResponse)

        await fetch(`${BASE}/runtime/invocation/${requestId}/response`, {
          method: 'POST',
          body: responseBody,
        })
        continue
      }

      // 3. Call handler with normalized payload
      const result = await handler(payload as any)

      // 4. Post response back
      const responseBody = fromFunctionUrl
        ? formatFunctionUrlResponse(result)
        : JSON.stringify(result)

      await fetch(`${BASE}/runtime/invocation/${requestId}/response`, {
        method: 'POST',
        body: responseBody,
      })
    } catch (error) {
      // Post error to Runtime API
      const errorPayload = JSON.stringify({
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        stackTrace: error instanceof Error ? error.stack?.split('\n') : [],
      })

      await fetch(`${BASE}/runtime/invocation/${requestId}/error`, {
        method: 'POST',
        headers: { 'Lambda-Runtime-Function-Error-Type': 'Runtime.UnhandledError' },
        body: errorPayload,
      })
    }
  }
}

// Start the runtime loop
runtimeLoop()
