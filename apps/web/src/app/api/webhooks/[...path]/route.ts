// apps/web/src/app/api/webhooks/[...path]/route.ts
/**
 * Dev proxy for app extension webhooks.
 *
 * In local dev, external services (Telegram, etc.) send webhooks to the ngrok
 * tunnel on port 3000 (web app). This route forwards them to the API server
 * on port 3007 where the webhook handler logic lives.
 *
 * In production, webhook URLs point directly to the API server — this route
 * is never hit.
 */

import { API_URL } from '@auxx/config/server'

async function proxyToApi(req: Request, params: { path: string[] }) {
  const path = params.path.join('/')
  const targetUrl = `${API_URL}/webhooks/${path}`

  console.log(`[webhook-proxy] ${req.method} → ${targetUrl}`)

  const response = await fetch(targetUrl, {
    method: req.method,
    headers: req.headers,
    body: req.method !== 'GET' ? await req.arrayBuffer() : undefined,
    // @ts-expect-error -- duplex needed for streaming body
    duplex: 'half',
  })

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToApi(req, await params)
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return proxyToApi(req, await params)
}
