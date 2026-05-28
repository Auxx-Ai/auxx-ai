// packages/lib/src/ingest/contacts/find-or-create-from-jwt.ts

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { UnifiedCrudHandler } from '../../resources/crud'
import { SystemUserService } from '../../users/system-user-service'
import { chatExternalId } from './external-id'

const log = createScopedLogger('chat-find-or-create-from-jwt')

export interface FindOrCreateContactFromJwtInput {
  organizationId: string
  /** Customer-chosen stable identifier (any string) — written as `chat:<userId>`. */
  userId: string
  /** Signed email from the customer's JWT, when present. Used for email-fold. */
  email?: string
  /** Caller-resolved attributes to write on create (phase 4 resolves these). */
  attributes?: Record<string, unknown>
  /** Optional userId for audit attribution on writes; defaults to 'system'. */
  actingUserId?: string
}

export interface FindOrCreateContactFromJwtResult {
  /** Resolved contact `EntityInstance.id`. */
  contactId: string
  /** How the contact was resolved this call. */
  resolution: 'matched_external_id' | 'matched_email' | 'created'
}

/**
 * Three-tier resolution for a chat-widget visitor identified by a verified
 * customer JWT:
 *
 *   1. Exact match on `external_id` containing `chat:<userId>`.
 *   2. If miss and `jwt.email` is present, match on `primary_email`. On hit,
 *      append `chat:<userId>` to the existing `external_id` array — no
 *      duplicate Contact created.
 *   3. Otherwise create a new Contact with `external_id: [chat:<userId>]`,
 *      `primary_email` (when present), and the resolved attribute map.
 *
 * Caller is responsible for verifying the JWT first; this function trusts
 * every claim it receives.
 */
export async function findOrCreateContactFromJwt(
  input: FindOrCreateContactFromJwtInput
): Promise<FindOrCreateContactFromJwtResult> {
  const { organizationId, userId, email, attributes = {}, actingUserId } = input

  // The default audit user must be a real `User.id` — passing the literal
  // 'system' fails the `EntityInstance.createdById → User.id` FK. The
  // SystemUserService creates/caches a per-org system user for exactly this
  // case (mirrors how `createIngestContext` resolves it).
  const resolvedActingUserId =
    actingUserId ?? (await SystemUserService.getSystemUserForActions(organizationId))

  const handler = new UnifiedCrudHandler(organizationId, resolvedActingUserId)
  const externalId = chatExternalId(userId)

  // Tier 1 — exact external-id match (multi-value containment via lookupByField).
  const byExternalId = await handler.findByField('contact', 'external_id', externalId)
  if (byExternalId) {
    return { contactId: byExternalId.id, resolution: 'matched_external_id' }
  }

  // Tier 2 — email-fold. Append our external_id to the existing Contact.
  // `findByField` returns the raw EntityInstance row with `values` as an array
  // of FieldValue rows — not a Record<systemAttribute, value>. Rather than
  // parse that to read the current external_id list and re-set it (which would
  // silently overwrite any other external_ids the Contact already carries),
  // use `mode: 'add'` so the handler appends with server-side dedup.
  if (email) {
    const byEmail = await handler.findByField('contact', 'primary_email', email)
    if (byEmail) {
      try {
        await handler.update(
          toRecordId('contact', byEmail.id),
          { external_id: [externalId], ...attributes },
          { external_id: 'add' }
        )
      } catch (error) {
        log.warn('Email-fold update failed, returning matched contact unchanged', {
          contactId: byEmail.id,
          error: (error as Error).message,
        })
      }
      return { contactId: byEmail.id, resolution: 'matched_email' }
    }
  }

  // Tier 3 — create on first sight.
  const { instance } = await handler.create('contact', {
    external_id: [externalId],
    ...(email ? { primary_email: email } : {}),
    contact_status: 'ACTIVE',
    ...attributes,
  })
  return { contactId: instance.id, resolution: 'created' }
}
