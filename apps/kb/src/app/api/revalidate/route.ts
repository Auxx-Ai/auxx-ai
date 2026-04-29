// apps/kb/src/app/api/revalidate/route.ts

import { revalidateTag } from 'next/cache'

export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  const secret = process.env.KB_REVALIDATE_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  let body: { tag?: string; tags?: string[] } = {}
  try {
    body = (await req.json()) as { tag?: string; tags?: string[] }
  } catch {
    return new Response('bad body', { status: 400 })
  }
  const tags = Array.isArray(body.tags) ? body.tags : body.tag ? [body.tag] : []
  if (tags.length === 0) return new Response('no tags', { status: 400 })

  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    if (!tag.startsWith('kb:') && !tag.startsWith('kb-article:')) continue
    revalidateTag(tag)
  }
  return Response.json({ ok: true, tags })
}
