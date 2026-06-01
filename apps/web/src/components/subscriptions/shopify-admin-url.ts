// apps/web/src/components/subscriptions/shopify-admin-url.ts

/**
 * Builds Shopify Admin deep-links from a shop domain (`cool-shop.myshopify.com`).
 * The merchant-facing Admin UI lives at `admin.shopify.com/store/<handle>`, not on the
 * `*.myshopify.com` domain — linking to `https://<shop>/admin/charges` 404s.
 */

/** `'cool-shop.myshopify.com'` → `'cool-shop'`. Returns null for non-myshopify domains. */
function storeHandle(shopDomain: string): string | null {
  const m = shopDomain.match(/^([^.]+)\.myshopify\.com$/)
  return m ? m[1] : null
}

/**
 * Org-level billing page: payment method on file + invoice/charge history.
 * Returns null when the shop domain can't be parsed (caller hides the link).
 */
export function shopifyBillingUrl(shopDomain: string): string | null {
  const handle = storeHandle(shopDomain)
  return handle ? `https://admin.shopify.com/store/${handle}/settings/organization-billing` : null
}

/**
 * The app's own page in Shopify Admin (Settings → Apps → Auxx) — where the merchant
 * manages the app subscription itself. Needs the app slug (`SHOPIFY_APP_HANDLE`),
 * surfaced to the client via the dehydrated environment. Returns null when either the
 * shop domain can't be parsed or the app handle is unset (caller hides the link).
 */
export function shopifyAppUrl(shopDomain: string, appHandle: string): string | null {
  const handle = storeHandle(shopDomain)
  if (!handle || !appHandle) return null
  return `https://admin.shopify.com/store/${handle}/settings/apps/app_installations/app/${appHandle}`
}
