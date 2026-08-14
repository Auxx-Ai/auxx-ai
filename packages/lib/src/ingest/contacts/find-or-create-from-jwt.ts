// packages/lib/src/ingest/contacts/find-or-create-from-jwt.ts

import { createScopedLogger } from '@auxx/logger'
import { getInstanceId, toRecordId } from '@auxx/types/resource'
import { getCachedEntityDefId } from '../../cache'
import { resolveShopifyStoreConnection } from '../../chat/shopify-identity-field'
import { findRecordByIdentity, upsertRecordIdentity } from '../../identity'
import { UnifiedCrudHandler } from '../../resources/crud'
import { SystemUserService } from '../../users/system-user-service'

const log = createScopedLogger('chat-find-or-create-from-jwt')

/** `RecordIdentity.source` for the app-less chat-visitor link. */
const CHAT_SOURCE = 'chat'
/** `RecordIdentity.source` + app field key for a Shopify storefront identity. */
const SHOPIFY_SOURCE = 'shopify'
const SHOPIFY_CUSTOMER_ID_FIELD_KEY = 'customerId'

export interface FindOrCreateContactFromJwtInput {
  organizationId: string
  /**
   * Customer-chosen stable identifier from the verified JWT's `user_id` claim.
   * For a plain chat visitor this is the raw id; for a Shopify App-Proxy mint
   * it's `shopify:<shop>:<customerId>` — but Shopify identity is resolved via
   * the connection-scoped `customerId` index using `shopify` below, not by
   * parsing this string. Used verbatim as the app-less `chat` index externalId
   * for non-Shopify visitors.
   */
  userId: string
  /** Signed email from the customer's JWT, when present. Used for email-fold. */
  email?: string
  /** Caller-resolved attributes to write on create/match. */
  attributes?: Record<string, unknown>
  /** Optional userId for audit attribution on writes; defaults to 'system'. */
  actingUserId?: string
  /**
   * Present when the JWT was minted by our Shopify App Proxy. Tier-1 then
   * resolves the contact by the connection-scoped `customerId` identity in
   * `RecordIdentity` (converging with connector-synced contacts, id-based, no
   * email required); absent → tier-1 resolves the app-less `chat:<userId>`
   * link. Both values come from App-Proxy-signed claims, never client input.
   */
  shopify?: { shopDomain: string; customerId: string }
}

export interface FindOrCreateContactFromJwtResult {
  /** Resolved contact `EntityInstance.id`. */
  contactId: string
  /** How the contact was resolved this call. */
  resolution: 'matched_external_id' | 'matched_email' | 'created'
}

/**
 * Three-tier resolution for a chat-widget visitor identified by a verified
 * customer JWT, backed by the `RecordIdentity` index (Phase 4 of the
 * multi-source identity plan — replaces the retired `external_id` array):
 *
 *   1. Identity index. Shopify visitor → resolve the store connection from the
 *      signed `shopDomain`, then look up
 *      `(source='shopify', connectionId, appFieldKey='customerId', externalId)`
 *      — this also matches connector-synced contacts. Otherwise look up the
 *      app-less `(source='chat', externalId=userId)` link.
 *   2. If miss and `jwt.email` is present, match on `primary_email` — no
 *      duplicate Contact created.
 *   3. Otherwise create a new Contact.
 *
 * For non-Shopify visitors the resolved contact's app-less `chat:<userId>`
 * link is mirrored into `RecordIdentity` (idempotent). Shopify identity is
 * written separately by `writeShopifyCustomerIdField` (the `customerId` cell +
 * its mirror), so no `chat` row is written for Shopify visitors.
 *
 * Caller is responsible for verifying the JWT first; this function trusts
 * every claim it receives.
 */
export async function findOrCreateContactFromJwt(
  input: FindOrCreateContactFromJwtInput
): Promise<FindOrCreateContactFromJwtResult> {
  const { organizationId, userId, email, attributes = {}, actingUserId, shopify } = input

  // The default audit user must be a real `User.id` — passing the literal
  // 'system' fails the `EntityInstance.createdById → User.id` FK. The
  // SystemUserService creates/caches a per-org system user for exactly this
  // case (mirrors how `createIngestContext` resolves it).
  const resolvedActingUserId =
    actingUserId ?? (await SystemUserService.getSystemUserForActions(organizationId))

  const handler = new UnifiedCrudHandler(organizationId, resolvedActingUserId)

  // The index is entity-scoped, so every read/write needs the contact def id.
  const contactDefId = await getCachedEntityDefId(organizationId, 'contact')
  if (!contactDefId) {
    // Without a def id we can't touch the index, but the value-path
    // resolution below (email-fold + create) still works.
    log.warn('No contact entity definition — skipping identity-index resolution', {
      organizationId,
    })
  }

  // Tier 1 — identity index.
  if (contactDefId) {
    const match = await resolveByIdentity({ organizationId, contactDefId, userId, shopify })
    if (match) {
      // Re-assert the app-less chat link (idempotent) so a contact first
      // resolved by email/Shopify still becomes reverse-resolvable by userId.
      if (!shopify) {
        await mirrorChatLink({ organizationId, contactDefId, contactId: match, userId })
      }
      return { contactId: match, resolution: 'matched_external_id' }
    }
  }

  // Tier 2 — email-fold. Attach our identity to the existing Contact.
  if (email) {
    const byEmail = await handler.findByField('contact', 'primary_email', email)
    if (byEmail) {
      if (Object.keys(attributes).length > 0) {
        try {
          await handler.update(toRecordId('contact', byEmail.id), attributes)
        } catch (error) {
          log.warn('Email-fold attribute update failed, returning matched contact unchanged', {
            contactId: byEmail.id,
            error: (error as Error).message,
          })
        }
      }
      if (!shopify && contactDefId) {
        await mirrorChatLink({ organizationId, contactDefId, contactId: byEmail.id, userId })
      }
      return { contactId: byEmail.id, resolution: 'matched_email' }
    }
  }

  // Tier 3 — create on first sight. Server-derived identity fields are spread
  // AFTER the caller attribute bag so no attribute can override the signed
  // JWT email. The email is array-wrapped for shape consistency with
  // multi-value fields (the write path auto-unwraps length-1 arrays on
  // single-value fields).
  const { instance } = await handler.create('contact', {
    contact_status: 'ACTIVE',
    ...attributes,
    ...(email ? { primary_email: [email] } : {}),
  })
  if (!shopify && contactDefId) {
    await mirrorChatLink({ organizationId, contactDefId, contactId: instance.id, userId })
  }
  return { contactId: instance.id, resolution: 'created' }
}

/**
 * Reverse-resolve the contact for this JWT via `RecordIdentity`. Shopify
 * visitors resolve the store connection first (connection-scoped so a customer
 * id colliding across two stores never cross-links); everyone else resolves
 * the app-less `chat` link.
 */
async function resolveByIdentity(opts: {
  organizationId: string
  contactDefId: string
  userId: string
  shopify?: { shopDomain: string; customerId: string }
}): Promise<string | null> {
  const { organizationId, contactDefId, userId, shopify } = opts

  if (shopify) {
    const store = await resolveShopifyStoreConnection(organizationId, shopify.shopDomain)
    if (!store) return null
    const match = await findRecordByIdentity({
      organizationId,
      entityDefinitionId: contactDefId,
      source: SHOPIFY_SOURCE,
      connectionId: store.connectionId,
      appFieldKey: SHOPIFY_CUSTOMER_ID_FIELD_KEY,
      externalId: shopify.customerId,
    })
    return match ? getInstanceId(match.recordId) : null
  }

  const match = await findRecordByIdentity({
    organizationId,
    entityDefinitionId: contactDefId,
    source: CHAT_SOURCE,
    externalId: userId,
    connectionId: null,
    appFieldKey: null,
  })
  return match ? getInstanceId(match.recordId) : null
}

/**
 * Mirror the app-less `chat:<userId>` link into `RecordIdentity`. This is the
 * chat visitor id's only home — no `CustomField`/`FieldValue` exists for it
 * (chat isn't an app). Best-effort: a missed mirror never fails contact
 * resolution; `reconcileRecordIdentities` cannot repair app-less links, so the
 * merge re-point + this explicit write are the guarantees.
 */
async function mirrorChatLink(opts: {
  organizationId: string
  contactDefId: string
  contactId: string
  userId: string
}): Promise<void> {
  const result = await upsertRecordIdentity({
    organizationId: opts.organizationId,
    entityInstanceId: opts.contactId,
    entityDefinitionId: opts.contactDefId,
    source: CHAT_SOURCE,
    appInstallationId: null,
    connectionId: null,
    appFieldKey: null,
    fieldId: null,
    externalId: opts.userId,
  })
  if (!result.ok) {
    log.warn('Failed to mirror chat visitor link into RecordIdentity', {
      contactId: opts.contactId,
      error: result.error.message,
    })
  }
}
