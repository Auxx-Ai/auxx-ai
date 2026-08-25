// packages/lib/src/shopify/chat-metafields.ts

import { listCredentials, revealSecrets } from '@auxx/credentials/store'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { createShopifyAdminClient } from './admin-client'

const logger = createScopedLogger('shopify/chat-metafields')

/**
 * Outcome of a metafield write. Every failure path is REPORTED, never swallowed.
 *
 * This used to return `void` and log-and-continue on all four failure branches, so
 * `bindChatChannelToShopifyInstall` returned `{ ok: true }` even when Shopify had received
 * nothing — the admin claimed "connected" while the storefront rendered nothing, with the
 * only evidence in a log line nobody was reading.
 */
export type MetafieldWriteResult = { ok: true } | { ok: false; reason: string }

export const AUXX_CHAT_METAFIELD_NAMESPACE = '$app:chat'
export const AUXX_CHAT_METAFIELD_KEY_CHANNEL = 'channel_id'
export const AUXX_CHAT_METAFIELD_KEY_AUDIENCE = 'audience'

const SHOP_GID_QUERY = `#graphql
  query ShopGid { shop { id } }
`

const METAFIELDS_SET_MUTATION = `#graphql
  mutation SetAuxxChatMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`

export interface WriteAuxxChatMetafieldsInput {
  shopDomain: string
  accessToken: string
  channelId?: string | null
  audience?: 'visitors' | 'both' | 'users' | null
}

/**
 * Write the `$app:chat.channel_id` and/or `$app:chat.audience` shop
 * metafields in the app-reserved namespace. Pass `null` to clear (the
 * Liquid embed treats blank as "not bound" and renders nothing).
 * Failures are logged, not thrown — the source of truth lives in our
 * DB, so a metafield write retry can be wired later without blocking
 * the calling mutation.
 *
 * Reserved-namespace metafields are hidden from the merchant's Custom
 * data UI, can't be read/written by other apps, and auto-delete on app
 * uninstall — no definition registration required.
 */
export async function writeAuxxChatMetafields(
  input: WriteAuxxChatMetafieldsInput
): Promise<MetafieldWriteResult> {
  const { shopDomain, accessToken, channelId, audience } = input
  if (channelId === undefined && audience === undefined) return { ok: true }

  const client = createShopifyAdminClient({ shopDomain, accessToken })

  let shopGid: string | undefined
  try {
    const response = await client.request(SHOP_GID_QUERY)
    shopGid = response.data?.shop?.id
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to fetch shop GID for metafield write', { shopDomain, error: message })
    // An expired or revoked Admin token surfaces here first, as a 401 on the cheapest
    // possible query — so this branch is the one to look for in prod when a bind "succeeds"
    // but the storefront never changes.
    return { ok: false, reason: `shop_gid_request_failed: ${message}` }
  }
  if (!shopGid) {
    logger.error('No shop GID returned from Shopify', { shopDomain })
    return { ok: false, reason: 'shop_gid_missing' }
  }

  const metafields: Array<{
    ownerId: string
    namespace: string
    key: string
    type: string
    value: string
  }> = []
  if (channelId !== undefined) {
    metafields.push({
      ownerId: shopGid,
      namespace: AUXX_CHAT_METAFIELD_NAMESPACE,
      key: AUXX_CHAT_METAFIELD_KEY_CHANNEL,
      type: 'single_line_text_field',
      value: channelId ?? '',
    })
  }
  if (audience !== undefined) {
    metafields.push({
      ownerId: shopGid,
      namespace: AUXX_CHAT_METAFIELD_NAMESPACE,
      key: AUXX_CHAT_METAFIELD_KEY_AUDIENCE,
      type: 'single_line_text_field',
      value: audience ?? 'visitors',
    })
  }

  try {
    const response = await client.request(METAFIELDS_SET_MUTATION, {
      variables: { metafields },
    })
    const errors = response.data?.metafieldsSet?.userErrors ?? []
    if (errors.length > 0) {
      logger.error('Shopify metafieldsSet userErrors', { shopDomain, errors })
      return { ok: false, reason: `user_errors: ${JSON.stringify(errors)}` }
    }
    // Success is logged at info with the exact namespace/key/value pairs, because the
    // storefront reading them back is a different system on a different machine — when the
    // widget doesn't appear, the first question is always "was anything actually written".
    logger.info('Wrote Auxx chat metafields', {
      shopDomain,
      namespace: AUXX_CHAT_METAFIELD_NAMESPACE,
      written: metafields.map((m) => ({ key: m.key, value: m.value })),
    })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Failed to write Shopify chat metafields', { shopDomain, error: message })
    return { ok: false, reason: `metafields_set_failed: ${message}` }
  }
}

/**
 * Fan out a chat-widget audience change to every Shopify install that has
 * `chatChannelId === channelId` in its AppSetting. Resolves each install's
 * Shopify access token (credential store) + shop domain (plaintext
 * metadata), then writes the `$app:chat.audience` metafield. Best-effort
 * per install — one shop's failure doesn't block the others.
 */
export async function fanOutAuxxChatAudienceToShopify(params: {
  channelId: string
  audience: 'visitors' | 'both' | 'users'
}): Promise<void> {
  const { channelId, audience } = params

  const shopifyAppRow = await database.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.slug, 'shopify'),
    columns: { id: true },
  })
  if (!shopifyAppRow) {
    logger.warn('No Shopify app row found — skipping metafield fan-out', { channelId })
    return
  }

  const rows = await database
    .select({
      credentialId: schema.Credential.id,
      organizationId: schema.Credential.organizationId,
    })
    .from(schema.AppSetting)
    .innerJoin(
      schema.AppInstallation,
      eq(schema.AppInstallation.id, schema.AppSetting.appInstallationId)
    )
    .innerJoin(
      schema.Credential,
      and(
        eq(schema.Credential.appInstallationId, schema.AppInstallation.id),
        eq(schema.Credential.appId, shopifyAppRow.id),
        eq(schema.Credential.kind, 'app')
      )
    )
    .where(
      and(
        eq(schema.AppSetting.key, 'chatChannelId'),
        sql`${schema.AppSetting.value} = ${JSON.stringify(channelId)}::jsonb`
      )
    )

  for (const row of rows) {
    try {
      const revealed = await revealSecrets<{ accessToken?: string }>(
        row.credentialId,
        row.organizationId
      )
      if (revealed.isErr()) {
        logger.warn('Failed to reveal Shopify credential during audience fan-out', {
          channelId,
          error: revealed.error.message,
        })
        continue
      }
      const accessToken = revealed.value.secrets.accessToken
      const shopDomain = resolveShopDomain(revealed.value.record.metadata)
      if (!accessToken || !shopDomain) {
        logger.warn('Shopify credential missing accessToken or shopDomain', { channelId })
        continue
      }
      const written = await writeAuxxChatMetafields({ shopDomain, accessToken, audience })
      if (!written.ok) {
        logger.warn('Audience fan-out did not reach Shopify', {
          channelId,
          shopDomain,
          reason: written.reason,
        })
      }
    } catch (error) {
      logger.error('Failed to fan out audience metafield to Shopify install', {
        channelId,
        error,
      })
    }
  }
}

/**
 * Bind a chat channel to a specific Shopify install (an `AppInstallation`
 * for the `shopify` app). Resolves the install's access token (credential
 * store) + shop domain (plaintext metadata), then writes the
 * `$app:chat.channel_id` and `$app:chat.audience` shop metafields in
 * the app-reserved namespace.
 *
 * Called from the chat-widget admin UI (phase 5) when the merchant picks
 * which channel powers a connected store. The App Store install flow
 * stays free of chat-widget logic.
 *
 * Pass `channelId = null` to unbind (the embed's Liquid renders nothing
 * when the metafield is blank).
 */
/**
 * Resolve a Shopify credential's shop domain, tolerating both shapes the codebase writes.
 *
 * `metadata.shopDomain` (full `x.myshopify.com`) is set only by the **App Store** install
 * path — `shopify.claimShopifyInstall`. A store connected from inside Auxx goes through the
 * generic `/api/apps/[slug]/oauth2/callback`, which writes the shop as a *subdomain* under
 * `metadata.connectionVariables.shop` and no `shopDomain` at all. Reading only the former
 * meant chat binding failed with `credential_missing_shop_or_token` for every in-app
 * connection — the majority of them.
 *
 * Same normalisation the Shopify app's own `getShopDomain` performs.
 */
function resolveShopDomain(metadata: Record<string, unknown>): string | undefined {
  const direct = metadata.shopDomain
  if (typeof direct === 'string' && direct) return direct

  const vars = metadata.connectionVariables as Record<string, unknown> | undefined
  const shop = vars?.shop
  if (typeof shop !== 'string' || !shop) return undefined
  return shop.includes('.') ? shop : `${shop}.myshopify.com`
}

export async function bindChatChannelToShopifyInstall(params: {
  organizationId: string
  appInstallationId: string
  channelId: string | null
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { organizationId, appInstallationId, channelId } = params

  const shopifyAppRow = await database.query.App.findFirst({
    where: (apps, { eq }) => eq(apps.slug, 'shopify'),
    columns: { id: true },
  })
  if (!shopifyAppRow) {
    return { ok: false, reason: 'shopify_app_not_found' }
  }

  const credsResult = await listCredentials({
    organizationId,
    kind: 'app',
    appId: shopifyAppRow.id,
    appInstallationId,
    userId: null,
  })
  if (credsResult.isErr()) {
    logger.error('Failed to list Shopify credentials for binding', {
      organizationId,
      appInstallationId,
      error: credsResult.error.message,
    })
    return { ok: false, reason: 'shopify_connection_not_found' }
  }
  const credential = credsResult.value[0]
  if (!credential) {
    return { ok: false, reason: 'shopify_connection_not_found' }
  }

  const revealed = await revealSecrets<{ accessToken?: string }>(credential.id, organizationId)
  if (revealed.isErr()) {
    logger.error('Failed to reveal Shopify credential for binding', {
      organizationId,
      appInstallationId,
      error: revealed.error.message,
    })
    return { ok: false, reason: 'decryption_failed' }
  }
  const accessToken = revealed.value.secrets.accessToken
  const shopDomain = resolveShopDomain(revealed.value.record.metadata)
  if (!accessToken || !shopDomain) {
    logger.error('Shopify credential unusable for chat binding', {
      organizationId,
      appInstallationId,
      credentialId: credential.id,
      hasAccessToken: Boolean(accessToken),
      resolvedShopDomain: shopDomain ?? null,
      metadataKeys: Object.keys(revealed.value.record.metadata ?? {}),
    })
    return { ok: false, reason: 'credential_missing_shop_or_token' }
  }

  let audience: 'visitors' | 'both' | 'users' = 'visitors'
  if (channelId) {
    const [widget] = await database
      .select({ chatAudience: schema.ChatWidget.chatAudience })
      .from(schema.ChatWidget)
      .where(eq(schema.ChatWidget.integrationId, channelId))
      .limit(1)
    audience = (widget?.chatAudience ?? 'visitors') as 'visitors' | 'both' | 'users'
  }

  logger.info('Binding chat channel to Shopify install', {
    organizationId,
    appInstallationId,
    shopDomain,
    channelId,
    audience,
    action: channelId ? 'bind' : 'unbind',
  })

  const written = await writeAuxxChatMetafields({
    shopDomain,
    accessToken,
    channelId,
    audience,
  })
  if (!written.ok) {
    return { ok: false, reason: written.reason }
  }

  return { ok: true }
}
