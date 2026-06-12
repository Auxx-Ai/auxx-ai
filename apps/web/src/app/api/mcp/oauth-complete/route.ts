// apps/web/src/app/api/mcp/oauth-complete/route.ts

import { type NextRequest, NextResponse } from 'next/server'

/**
 * Popup termination page, rendered on the *opener's* origin so the OAuth result reliably reaches
 * the app window.
 *
 * The MCP OAuth callback necessarily runs on the public tunnel origin (NGROK_URL) so external
 * providers (Stripe, etc.) can reach it. A popup that ends on that cross-origin page can't notify
 * the localhost app window: `BroadcastChannel` is origin-scoped, and `window.opener` is commonly
 * severed by the provider's `Cross-Origin-Opener-Policy: same-origin` header during the redirect
 * chain. The callback therefore redirects the popup *here* — same origin as the opener — where both
 * the `oauth-mcp-connect` BroadcastChannel and `postMessage` reach the app window.
 */
export function GET(request: NextRequest): NextResponse {
  const ok = request.nextUrl.searchParams.get('ok') === 'true'
  const error = request.nextUrl.searchParams.get('error')
  const message = { type: 'oauth_done', ok, error: ok ? null : error || 'Connection failed' }
  const serializedMessage = JSON.stringify(message).replace(/</g, '\\u003c')
  const heading = ok ? 'Connected' : 'Connection failed'
  const body = ok
    ? 'You can close this window.'
    : `Something went wrong: ${error || 'Unknown error'}. You can close this window.`
  // Post the result, THEN close after a beat. After the provider's COOP header severs
  // `window.opener`, BroadcastChannel is the only channel left — and closing the window in the
  // same tick can drop the not-yet-dispatched message, so the close is deferred to let it flush.
  const html = `<!doctype html>
<html><head><title>${heading}</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 2rem; text-align: center;">
<h1>${heading}</h1><p>${body}</p>
<script>(function(){var p=${serializedMessage};var bc=null;
try{if(window.opener){window.opener.postMessage(p,window.location.origin);}}catch(_){}
try{bc=new BroadcastChannel('oauth-mcp-connect');bc.postMessage(p);}catch(_){}
setTimeout(function(){try{if(bc)bc.close();}catch(_){}try{window.close();}catch(_){}},400);})();</script>
</body></html>`
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html' },
  })
}
