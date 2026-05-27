// packages/lib/src/ingest/contacts/find-or-create-from-jwt.ts

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { UnifiedCrudHandler } from '../../resources/crud'
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
  const { organizationId, userId, email, attributes = {}, actingUserId = 'system' } = input

  const handler = new UnifiedCrudHandler(organizationId, actingUserId)
  const externalId = chatExternalId(userId)

  // Tier 1 — exact external-id match (multi-value containment via lookupByField).
  const byExternalId = await handler.findByField('contact', 'external_id', externalId)
  if (byExternalId) {
    return { contactId: byExternalId.id, resolution: 'matched_external_id' }
  }

  // Tier 2 — email-fold. Append our external_id to the existing Contact.
  if (email) {
    const byEmail = await handler.findByField('contact', 'primary_email', email)
    if (byEmail) {
      const existingExternal = Array.isArray(byEmail.values?.external_id)
        ? (byEmail.values.external_id as string[])
        : []
      const nextExternal = existingExternal.includes(externalId)
        ? existingExternal
        : [...existingExternal, externalId]

      try {
        await handler.update(toRecordId('contact', byEmail.id), {
          external_id: nextExternal,
          ...attributes,
        })
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
