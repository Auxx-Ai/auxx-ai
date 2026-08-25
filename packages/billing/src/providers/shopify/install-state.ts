// packages/billing/src/providers/shopify/install-state.ts

import { configService } from '@auxx/credentials'
import { getAppConnection } from '@auxx/credentials/connections'
import { createScopedLogger } from '@auxx/logger'
import { credentialLock } from '../../credential-lock'
import { createShopifyAdminClient } from './client'

const logger = createScopedLogger('billing/shopify/install-state')

/** The cheapest authenticated Admin API call there is — we only care whether it answers. */
const PROBE_QUERY = `#graphql
  query ShopInstallProbe { shop { id } }
`

/**
 * Answers whether the app is still installed on a shop, using the org's stored access
 * token. Shopify revokes that token at uninstall, so a 401/403 is a definitive "no".
 *
 * Any other outcome — network failure, schema error, missing credential — returns `true`.
 * The caller uses this to choose between the hosted pricing page and a reinstall link,
 * and sending an installed merchant to reinstall is the worse of the two errors.
 */
export async function isAppInstalled(input: {
  shopDomain: string
  organizationId: string
}): Promise<boolean> {
  const appId = configService.get<string>('SHOPIFY_APP_ID')
  if (!appId) throw new Error('SHOPIFY_APP_ID must be configured')

  try {
    // Org-scoped connection (written at install) — an empty userId falls through
    // getAppConnection's user-scoped lookup, same as active-subscription.ts.
    const conn = await getAppConnection(appId, input.organizationId, '', { lock: credentialLock })
    if (conn.isErr()) throw conn.error
    const accessToken = conn.value.accessToken
    if (!accessToken) throw new Error('Shopify connection has no access token')

    const client = createShopifyAdminClient({ shopDomain: input.shopDomain, accessToken })
    const res = (await client.request(PROBE_QUERY)) as {
      errors?: { networkStatusCode?: number }
    }
    const statusCode = res.errors?.networkStatusCode
    if (statusCode === 401 || statusCode === 403) {
      logger.info('Shopify app is uninstalled — token rejected', {
        shopDomain: input.shopDomain,
        statusCode,
      })
      return false
    }
    return true
  } catch (error) {
    logger.warn('Install probe failed — assuming still installed', {
      shopDomain: input.shopDomain,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}
