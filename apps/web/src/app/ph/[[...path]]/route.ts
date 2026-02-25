// apps/web/src/app/ph/[[...path]]/route.ts

import type { NextRequest } from 'next/server'

const POSTHOG_INGEST = 'https://us.i.posthog.com'
const POSTHOG_ASSETS = 'https://us-assets.i.posthog.com'

async function handler(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/^\/ph/, '')
  const search = request.nextUrl.search

  const isAsset = path.startsWith('/static/')
  const origin = isAsset ? POSTHOG_ASSETS : POSTHOG_INGEST
  const destinationUrl = `${origin}${path}${search}`

  const headers = new Headers(request.headers)
  headers.set('host', new URL(origin).host)
  headers.delete('connection')

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.blob()

  const response = await fetch(destinationUrl, {
    method: request.method,
    headers,
    body,
  })

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export const GET = handler
export const POST = handler
