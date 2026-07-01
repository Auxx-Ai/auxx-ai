// packages/lib/src/chat/shopify-identity-field.ts

import { listCredentials } from '@auxx/credentials/store'
import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
import { getCachedEntityDefId } from '../cache'
import { FieldValueService } from '../field-values/field-value-service'
import { upsertRecordIdentity } from '../identity'

const log = createScopedLogger('chat-shopify-identity-field')

/** The app-stable field key the Shopify app registers (see auxxai-apps fields.ts). */
const SHOPIFY_CUSTOMER_ID_FIELD_KEY = 'customerId'
/** `RecordIdentity.source` — the Shopify app's slug. */
const SHOPIFY_SOURCE = 'shopify'

interface WriteShopifyCustomerIdInput {
  organizationId: string
  /** Verified contact (EntityInstance) id the value is written onto. */
  contactId: string
  /** Trusted shop domain from the App-Proxy-signed JWT (never client input). */
  shopDomain: string
  /** Trusted Shopify customer id from the App-Proxy-signed JWT. */
  shopifyCustomerId: string
  db?: Database
}

/** The Shopify app installation + bound store connection for one shop domain. */
export interface ShopifyStoreConnection {
  appId: string
  installationId: string
  connectionId: string
}

/**
 * Resolve the Shopify app installation + the store `Credential` bound to a
 * trusted shop domain, org-scoped. This is the same app→installation→credential
 * chain `writeShopifyCustomerIdField` walks and the same binding check
 * `shopify-proxy.ts` performs at JWT mint — extracted so the chat JWT resolver
 * can reuse it for connection-scoped identity lookup.
 *
 * `shopDomain` MUST come from an App-Proxy-signed JWT claim, never a spoofable
 * client attribute. Returns `null` (never throws) when the app isn't installed,
 * credentials can't be listed, or no connection matches the shop.
 */
export async function resolveShopifyStoreConnection(
  organizationId: string,
  shopDomain: string,
  db: Database = database
): Promise<ShopifyStoreConnection | null> {
  const shopifyApp = await db.query.App.findFirst({
    where: eq(schema.App.slug, 'shopify'),
    columns: { id: true },
  })
  if (!shopifyApp) return null

  const installation = await db.query.AppInstallation.findFirst({
    where: and(
      eq(schema.AppInstallation.appId, shopifyApp.id),
      eq(schema.AppInstallation.organizationId, organizationId),
      isNull(schema.AppInstallation.uninstalledAt)
    ),
    columns: { id: true },
  })
  if (!installation) return null

  const credsResult = await listCredentials({
    organizationId,
    kind: 'app',
    appId: shopifyApp.id,
    userId: null,
  })
  if (credsResult.isErr()) {
    log.warn('Failed to list Shopify credentials during connection resolution', {
      organizationId,
      error: credsResult.error.message,
    })
    return null
  }

  const connectionId = credsResult.value.find((cred) => cred.metadata.shopDomain === shopDomain)?.id
  if (!connectionId) return null

  return { appId: shopifyApp.id, installationId: installation.id, connectionId }
}

/**
 * Write the verified visitor's Shopify customer id onto their contact's
 * **connection-scoped** `customerId` app field, so the chat restriction engine
 * can resolve `visitor:<…customerId…>` and clamp the order tools' scope arg to
 * this visitor (plans/chat/v6 phase-5 §2).
 *
 * Both inputs MUST come from the App-Proxy-signed JWT claims
 * (`shopify_shop_domain`, `shopify_customer_id`) — never from a spoofable
 * client attribute. The trust boundary is the caller's responsibility.
 *
 * Resolution chain (all org-scoped):
 *   1. Shopify `App` → its non-uninstalled `AppInstallation` for the org.
 *   2. The bound store connection: the `kind: 'app'` `Credential` row whose
 *      plaintext `metadata.shopDomain` equals `shopDomain`. This is the same
 *      binding check `shopify-proxy.ts` performs at JWT mint.
 *   3. The connection-scoped `CustomField` for
 *      `(appInstallationId, connectionId, appFieldKey='customerId')`.
 *   4. `FieldValueService.setValue` writes the value — the exact row the var
 *      resolver reads back via `batchGetValues`.
 *
 * Best-effort: any missing link (app not installed, store not connected, field
 * not yet provisioned) is logged and returns `false` rather than throwing — a
 * passport mint must never fail because the identity field couldn't be written.
 * The phase-3 fail-closed gate + phase-4 banner surface the un-resolvable var.
 */
export async function writeShopifyCustomerIdField(
  input: WriteShopifyCustomerIdInput
): Promise<boolean> {
  const db = input.db ?? database
  const { organizationId, contactId, shopDomain, shopifyCustomerId } = input

  // 1+2. Shopify app installation + the store connection bound to this domain.
  const store = await resolveShopifyStoreConnection(organizationId, shopDomain, db)
  if (!store) {
    log.warn('No bound Shopify connection for shop domain — skipping customerId field write', {
      organizationId,
      shopDomain,
    })
    return false
  }
  const { installationId, connectionId } = store

  // 3. The connection-scoped customerId field def for this store.
  const field = await db.query.CustomField.findFirst({
    where: and(
      eq(schema.CustomField.organizationId, organizationId),
      eq(schema.CustomField.appInstallationId, installationId),
      eq(schema.CustomField.connectionId, connectionId),
      eq(schema.CustomField.appFieldKey, SHOPIFY_CUSTOMER_ID_FIELD_KEY)
    ),
    columns: { id: true },
  })
  if (!field) {
    log.warn('Shopify customerId field not provisioned for connection — skipping write', {
      organizationId,
      connectionId,
    })
    return false
  }

  // 4. Write the value the var resolver reads back. App fields are user-write
  //    protected at the definition level, but this is platform-side identity
  //    plumbing, not a user edit.
  const service = new FieldValueService(organizationId, undefined, db)
  await service.setValue({
    recordId: toRecordId('contact', contactId),
    fieldId: field.id,
    value: shopifyCustomerId,
  })

  // 5. Mirror into the reverse-lookup index. Converges with the connector on
  //    the same (connection, appFieldKey) cell by construction. Best-effort —
  //    a missed mirror never fails the passport write; reconcileRecordIdentities
  //    is the backstop.
  const contactDefId = await getCachedEntityDefId(organizationId, 'contact')
  if (!contactDefId) {
    log.warn('No entity definition for contact — skipping RecordIdentity mirror', {
      organizationId,
    })
    return true
  }
  const mirrored = await upsertRecordIdentity(
    {
      organizationId,
      entityInstanceId: contactId,
      entityDefinitionId: contactDefId,
      source: SHOPIFY_SOURCE,
      appInstallationId: installationId,
      connectionId,
      appFieldKey: SHOPIFY_CUSTOMER_ID_FIELD_KEY,
      fieldId: field.id,
      externalId: shopifyCustomerId,
    },
    db
  )
  if (!mirrored.ok) {
    log.warn('Failed to mirror Shopify customerId into RecordIdentity', {
      organizationId,
      contactId,
      error: mirrored.error.message,
    })
  }

  return true
}
