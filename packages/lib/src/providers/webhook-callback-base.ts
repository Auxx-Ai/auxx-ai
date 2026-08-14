// packages/lib/src/providers/webhook-callback-base.ts

import { WEBAPP_URL } from '@auxx/config/server'

/**
 * Public base URL external services deliver channel webhooks to.
 *
 * In dev, `NGROK_URL` points callbacks at the tunnel — the same convention every OAuth
 * redirect base uses (`process.env.NGROK_URL || WEBAPP_URL`); providers like Microsoft
 * Graph reject non-HTTPS notification URLs outright, so localhost can never receive them.
 * In production `NGROK_URL` is unset and the public `WEBAPP_URL` applies. Server-side only.
 */
export function webhookCallbackBase(): string {
  return process.env.NGROK_URL || WEBAPP_URL
}

/** Callback URL for a provider's inbound webhook route (e.g. `/api/outlook/webhook`). */
export function providerWebhookCallbackUrl(providerType: string): string {
  return `${webhookCallbackBase()}/api/${providerType}/webhook`
}
