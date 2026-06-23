// packages/lib/src/webhooks/inbound/verify/shopify-app-proxy.ts
// Shopify App Proxy HMAC — the storefront proxy signs the request's QUERY PARAMS
// (not headers/body), so it has its own entry rather than going through the
// header-based `verifyWebhook` dispatcher. Remaining params are sorted as `key=value`,
// concatenated without separators, HMAC-SHA256'd with the Partner App secret (hex).
//
// Docs: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data

import { createHmac } from 'node:crypto'
import { timingSafeStringEqual } from './compare'

/** Verify a Shopify App Proxy `signature` query param against the app secret. */
export function verifyShopifyAppProxy(searchParams: URLSearchParams, secret: string): boolean {
  if (!secret) return false
  const signature = searchParams.get('signature')
  if (!signature) return false

  const pairs: string[] = []
  searchParams.forEach((value, key) => {
    if (key !== 'signature') pairs.push(`${key}=${value}`)
  })
  pairs.sort()
  const calculated = createHmac('sha256', secret).update(pairs.join('')).digest('hex')
  return timingSafeStringEqual(calculated, signature)
}
