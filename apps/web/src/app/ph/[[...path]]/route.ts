// apps/web/src/app/ph/[[...path]]/route.ts

import type { NextRequest } from 'next/server'

const POSTHOG_INGEST = 'https://us.i.posthog.com'
const POSTHOG_ASSETS = 'https://us-assets.i.posthog.com'

// Cloudflare and proxy-injected headers must be stripped before forwarding to
// PostHog (also behind Cloudflare). Forwarding cf-connecting-ip from one CF zone
// to another trips Error 1000 ("DNS points to prohibited IP") on us-assets.
const STRIPPED_HEADERS = new Set([
  'host',
  'connection',
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cf-ipcountry',
  'cf-worker',
  'cdn-loop',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'forwarded',
])

async function handler(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/^\/ph/, '')
  const search = request.nextUrl.search

  const isAsset = path.startsWith('/static/')
  const origin = isAsset ? POSTHOG_ASSETS : POSTHOG_INGEST
  const destinationUrl = `${origin}${path}${search}`

  const headers = new Headers()
  for (const [key, value] of request.headers) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) headers.set(key, value)
  }
  headers.set('host', new URL(origin).host)

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.blob()

  const response = await fetch(destinationUrl, {
    method: request.method,
    headers,
    body,
  })

  // Fully consume the response to avoid truncation from content-encoding mismatches
  const data = await response.arrayBuffer()
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')
  responseHeaders.delete('transfer-encoding')

  return new Response(data, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export const GET = handler
export const POST = handler
