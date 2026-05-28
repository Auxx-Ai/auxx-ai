// packages/lib/src/shopify/chat-metafields.ts

import { CredentialService } from '@auxx/credentials'
import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { createShopifyAdminClient } from './shopify-webhooks'

const logger = createScopedLogger('shopify/chat-metafields')

export const AUXX_CHAT_METAFIELD_NAMESPACE = 'auxx'
export const AUXX_CHAT_METAFIELD_KEY_CHANNEL = 'chat_channel_id'
export const AUXX_CHAT_METAFIELD_KEY_AUDIENCE = 'chat_audience'

const METAFIELD_DEFINITIONS_MUTATION = `#graphql
  mutation EnsureAuxxChatMetafieldDefinitions(
    $channel: MetafieldDefinitionInput!,
    $audience: MetafieldDefinitionInput!
  ) {
    channelDef: metafieldDefinitionCreate(definition: $channel) {
      createdDefinition { id }
      userErrors { field message code }
    }
    audienceDef: metafieldDefinitionCreate(definition: $audience) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }
`

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
 * Register the `auxx.chat_channel_id` and `auxx.chat_audience` shop
 * metafield definitions with storefront read access so the theme can read
 * them from Liquid without merchant intervention. Idempotent — Shopify
 * returns a `TAKEN` userError when a definition already exists; we treat
 * that as success.
 */
export async function ensureAuxxChatMetafieldDefinitions(params: {
  shopDomain: string
  accessToken: string
}): Promise<void> {
  const { shopDomain, accessToken } = params
  const client = createShopifyAdminClient({ shopDomain, accessToken })

  const channel = {
    namespace: AUXX_CHAT_METAFIELD_NAMESPACE,
    key: AUXX_CHAT_METAFIELD_KEY_CHANNEL,
    name: 'Auxx chat channel',
    description: 'Auxx chat channel ID powering the storefront widget.',
    type: 'single_line_text_field',
    ownerType: 'SHOP',
    pin: true,
    access: { storefront: 'PUBLIC_READ' },
  }
  const audience = {
    namespace: AUXX_CHAT_METAFIELD_NAMESPACE,
    key: AUXX_CHAT_METAFIELD_KEY_AUDIENCE,
    name: 'Auxx chat audience',
    description: 'Auxx chat audience policy: visitors, both, or users.',
    type: 'single_line_text_field',
    ownerType: 'SHOP',
    pin: true,
    access: { storefront: 'PUBLIC_READ' },
  }

  try {
    const response = await client.request(METAFIELD_DEFINITIONS_MUTATION, {
      variables: { channel, audience },
    })
    const errors = [
      ...(response.data?.channelDef?.userErrors ?? []),
      ...(response.data?.audienceDef?.userErrors ?? []),
    ].filter((e: { code?: string }) => e.code !== 'TAKEN')
    if (errors.length > 0) {
      logger.warn('Shopify metafield definition userErrors', { shopDomain, errors })
    }
  } catch (error) {
    logger.error('Failed to register Shopify chat metafield definitions', { shopDomain, error })
  }
}

/**
 * Write the `auxx.chat_channel_id` and/or `auxx.chat_audience` shop
 * metafields. Pass `null` to clear (the Liquid embed treats blank as
 * "not bound" and renders nothing). Failures are logged, not thrown —
 * the source of truth lives in our DB, so a metafield write retry can
 * be wired later without blocking the calling mutation.
 */
export async function writeAuxxChatMetafields(input: WriteAuxxChatMetafieldsInput): Promise<void> {
  const { shopDomain, accessToken, channelId, audience } = input
  if (channelId === undefined && audience === undefined) return

  const client = createShopifyAdminClient({ shopDomain, accessToken })

  let shopGid: string | undefined
  try {
    const response = await client.request(SHOP_GID_QUERY)
    shopGid = response.data?.shop?.id
  } catch (error) {
    logger.error('Failed to fetch shop GID for metafield write', { shopDomain, error })
    return
  }
  if (!shopGid) {
    logger.error('No shop GID returned from Shopify', { shopDomain })
    return
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
    }
  } catch (error) {
    logger.error('Failed to write Shopify chat metafields', { shopDomain, error })
  }
}

/**
 * Fan out a chat-widget audience change to every Shopify install that has
 * `chatChannelId === channelId` in its AppSetting. Looks up each install's
 * Shopify access token + shop domain by decrypting its
 * `WorkflowCredentials.encryptedData`, then writes the
 * `auxx.chat_audience` metafield. Best-effort per install — one shop's
 * failure doesn't block the others.
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
      encryptedData: schema.WorkflowCredentials.encryptedData,
    })
    .from(schema.AppSetting)
    .innerJoin(
      schema.AppInstallation,
      eq(schema.AppInstallation.id, schema.AppSetting.appInstallationId)
    )
    .innerJoin(
      schema.WorkflowCredentials,
      and(
        eq(schema.WorkflowCredentials.appInstallationId, schema.AppInstallation.id),
        eq(schema.WorkflowCredentials.appId, shopifyAppRow.id),
        eq(schema.WorkflowCredentials.type, 'app-connection')
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
      const decrypted = CredentialService.decrypt(row.encryptedData) as {
        accessToken?: string
        metadata?: { shopDomain?: string }
      }
      const accessToken = decrypted.accessToken
      const shopDomain = decrypted.metadata?.shopDomain
      if (!accessToken || !shopDomain) {
        logger.warn('Shopify credential missing accessToken or shopDomain', { channelId })
        continue
      }
      await writeAuxxChatMetafields({ shopDomain, accessToken, audience })
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
 * for the `shopify` app). Resolves the install's access token + shop
 * domain by decrypting its org-scoped `WorkflowCredentials`, registers
 * the metafield definitions (idempotent), then writes the
 * `auxx.chat_channel_id` and `auxx.chat_audience` shop metafields.
 *
 * Called from the chat-widget admin UI (phase 5) when the merchant picks
 * which channel powers a connected store. The App Store install flow
 * stays free of chat-widget logic.
 *
 * Pass `channelId = null` to unbind (the embed's Liquid renders nothing
 * when the metafield is blank).
 */
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

  const credential = await database.query.WorkflowCredentials.findFirst({
    where: (creds, { and, eq, isNull }) =>
      and(
        eq(creds.appInstallationId, appInstallationId),
        eq(creds.organizationId, organizationId),
        eq(creds.appId, shopifyAppRow.id),
        eq(creds.type, 'app-connection'),
        isNull(creds.userId)
      ),
    columns: { encryptedData: true },
  })
  if (!credential) {
    return { ok: false, reason: 'shopify_connection_not_found' }
  }

  let accessToken: string | undefined
  let shopDomain: string | undefined
  try {
    const decrypted = CredentialService.decrypt(credential.encryptedData) as {
      accessToken?: string
      metadata?: { shopDomain?: string }
    }
    accessToken = decrypted.accessToken
    shopDomain = decrypted.metadata?.shopDomain
  } catch (error) {
    logger.error('Failed to decrypt Shopify credential for binding', {
      organizationId,
      appInstallationId,
      error,
    })
    return { ok: false, reason: 'decryption_failed' }
  }
  if (!accessToken || !shopDomain) {
    return { ok: false, reason: 'credential_missing_shop_or_token' }
  }

  await ensureAuxxChatMetafieldDefinitions({ shopDomain, accessToken })

  let audience: 'visitors' | 'both' | 'users' = 'visitors'
  if (channelId) {
    const [widget] = await database
      .select({ chatAudience: schema.ChatWidget.chatAudience })
      .from(schema.ChatWidget)
      .where(eq(schema.ChatWidget.integrationId, channelId))
      .limit(1)
    audience = (widget?.chatAudience ?? 'visitors') as 'visitors' | 'both' | 'users'
  }

  await writeAuxxChatMetafields({
    shopDomain,
    accessToken,
    channelId,
    audience,
  })

  return { ok: true }
}
