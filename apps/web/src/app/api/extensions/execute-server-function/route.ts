// apps/web/src/app/api/extensions/execute-server-function/route.ts

import crypto from 'node:crypto'
import { API_URL } from '@auxx/config/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '~/auth/server'

const bodySchema = z.object({
  appId: z.string().min(1),
  installationId: z.string().min(1),
  organizationHandle: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  function_identifier: z.string().min(1),
  function_args: z.string().optional(),
})

/**
 * Thin auth proxy for server function execution.
 * Validates the browser session (same-origin cookies), then forwards
 * to the Express API with HMAC-signed internal auth headers.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    )
  }

  const { user } = session

  // Parse and validate body
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } },
      { status: 400 }
    )
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parsed.error.issues,
        },
      },
      { status: 400 }
    )
  }

  const { appId, installationId, organizationHandle, function_identifier, function_args } =
    parsed.data

  // Build HMAC signature for internal auth
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) {
    console.error('[ServerFunctionProxy] BETTER_AUTH_SECRET not configured')
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Server misconfigured' } },
      { status: 500 }
    )
  }

  const timestamp = Date.now().toString()
  const payload = `${user.id}:${user.email}:${timestamp}`
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')

  // Forward to Express API
  const endpoint =
    `${API_URL}/api/v1/organizations/${encodeURIComponent(organizationHandle)}` +
    `/apps/${encodeURIComponent(appId)}/installations/${encodeURIComponent(installationId)}/execute-server-function`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Internal ${signature}`,
      'X-Internal-User-Id': user.id,
      'X-Internal-User-Email': user.email,
      'X-Internal-User-Name': user.name ?? '',
      'X-Internal-Timestamp': timestamp,
    },
    body: JSON.stringify({ function_identifier, function_args }),
  })

  // Pass through response (handle non-JSON upstream failures)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    console.error(
      '[ServerFunctionProxy] Non-JSON upstream response:',
      response.status,
      text.slice(0, 200)
    )
    return Response.json(
      {
        error: { code: 'UPSTREAM_ERROR', message: 'Upstream service returned a non-JSON response' },
      },
      { status: 502 }
    )
  }

  const result = await response.json()
  return Response.json(result, { status: response.status })
}
