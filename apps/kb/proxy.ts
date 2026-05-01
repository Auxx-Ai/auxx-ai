// apps/kb/proxy.ts

import { type NextRequest, NextResponse } from 'next/server'

const KB_ROOT_HOST = process.env.KB_ROOT_HOST ?? 'kb.auxx.ai'

export function proxy(req: NextRequest) {
  const host = req.headers.get('host')
  const url = req.nextUrl

  // Article URLs ending in `.md` serve a plain-text Markdown rendering. The
  // suffix is rewritten onto an internal `/md/...` segment so the dedicated
  // Route Handler can coexist with the existing HTML `page.tsx` at the same
  // dynamic segment (Next.js doesn't allow both at one path). The segment
  // can't start with `_` — Next treats `_*` folders as private and excludes
  // them from routing.
  if (url.pathname.endsWith('.md')) {
    const stripped = url.pathname.slice(0, -3)
    return NextResponse.rewrite(new URL(`/md${stripped}${url.search}`, req.url))
  }

  // TODO(custom-domains): when KnowledgeBase.customDomain ships, look up the
  // KB by host and rewrite to /<orgSlug>/<kbSlug>/... Until then, custom hosts
  // are routed to a stub path so they 404 in a controlled way.
  if (
    host &&
    !host.endsWith(KB_ROOT_HOST) &&
    !host.startsWith('localhost') &&
    !host.startsWith('127.0.0.1')
  ) {
    return NextResponse.rewrite(new URL(`/_custom/${host}${url.pathname}`, req.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
