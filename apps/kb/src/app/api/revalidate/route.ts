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
    // Next 16 requires a cacheLife profile here. `{ expire: 0 }` is the
    // immediate-expiry form: the entry is dropped and the next reader
    // recomputes. A named profile (e.g. 'max') would instead be
    // stale-while-revalidate, which serves the pre-edit article to the very
    // next visitor — wrong for a publish webhook, and unrecoverable here
    // because every KB cache is `cacheLife('max')` (expire: 365 days), so this
    // endpoint is the only thing that ever refreshes them. `updateTag` is the
    // other immediate option but throws outside a Server Action.
    revalidateTag(tag, { expire: 0 })
  }
  return Response.json({ ok: true, tags })
}
