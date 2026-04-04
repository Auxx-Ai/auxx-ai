// apps/docs/src/app/api/content/route.ts

import { source } from '@/lib/source'

/**
 * GET /api/content?url=/help/channels/gmail
 *
 * Returns the page title, description, and plain text content
 * extracted from Fumadocs structuredData for LLM consumption.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return Response.json({ error: 'url parameter is required' }, { status: 400 })
  }

  // Convert URL path to slug array: "/help/channels/gmail" → ["help", "channels", "gmail"]
  const slug = url.split('/').filter(Boolean)
  const page = source.getPage(slug)

  if (!page) {
    return Response.json({ error: 'Page not found' }, { status: 404 })
  }

  const { structuredData } = page.data

  // Reconstruct readable text from structuredData.contents
  // Each content entry may have a heading and always has content text
  const text = structuredData.contents
    .map((c) => (c.heading ? `## ${c.heading}\n${c.content}` : c.content))
    .join('\n\n')

  return Response.json({
    title: page.data.title,
    description: page.data.description ?? null,
    url: page.url,
    content: text,
  })
}
