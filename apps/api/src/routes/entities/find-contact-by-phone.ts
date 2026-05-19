// apps/api/src/routes/entities/find-contact-by-phone.ts

/**
 * Lambda SDK callback for `ctx.entities.findContactByPhone`.
 *
 * Authorized via the `entities` callback token scope minted by
 * `prepareLambdaContext` for AI tool invocations. Normalizes the input
 * phone to E.164 (when possible), then looks up a contact-kind
 * EntityInstance whose PHONE-type FieldValue matches (case-insensitive
 * exact). Returns the auxx recordId (`<defId>:<instId>`) plus display name.
 *
 * Used by integrations whose identity is keyed on a phone number —
 * WhatsApp first, Twilio next. See plans/kopilot/apps/whatsapp-overhaul.md §6.
 */

import { database, schema } from '@auxx/database'
import { getCachedCustomFields, getCachedEntityDefId } from '@auxx/lib/cache'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const findContactByPhone = new Hono<AppContext>()

const FindContactByPhoneSchema = z.object({
  phone: z.string().min(1),
})

/**
 * Best-effort E.164 normalization: strip all formatting, prepend `+`.
 *
 * Mirrors the client-side `normalizePhone` in the WhatsApp tool surface
 * (`apps/whatsapp/src/tools/shared/normalize-phone.ts`) so both sides
 * round-trip the same value. This is intentionally dumb — no country
 * inference, no validation. Inputs without a country code stored at the
 * other side won't match; that's a data-quality issue flagged in the
 * overhaul plan §8, not a normalizer concern.
 */
function normalizeToE164(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/[^\d]/g, '')}`
  }
  const digits = trimmed.replace(/[^\d]/g, '')
  if (!digits) return ''
  return `+${digits}`
}

findContactByPhone.post('/find-contact-by-phone', async (c) => {
  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.res

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = FindContactByPhoneSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }

  const normalized = normalizeToE164(parsed.data.phone)
  if (!normalized) return c.json({ entity: null })

  const defId = await getCachedEntityDefId(auth.organizationId, 'contact')
  if (!defId) return c.json({ entity: null })

  const fields = await getCachedCustomFields(auth.organizationId, defId)
  const phoneFieldIds = fields.filter((f) => f.type === 'PHONE_INTL').map((f) => f.id)
  if (phoneFieldIds.length === 0) return c.json({ entity: null })

  const row = await database
    .select({
      instanceId: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.organizationId, auth.organizationId),
        eq(schema.FieldValue.entityDefinitionId, defId),
        inArray(schema.FieldValue.fieldId, phoneFieldIds),
        sql`lower(${schema.FieldValue.valueText}) = ${normalized.toLowerCase()}`
      )
    )
    .limit(1)

  const hit = row[0]
  if (!hit) return c.json({ entity: null })

  return c.json({
    entity: {
      recordId: `${defId}:${hit.instanceId}`,
      displayName: hit.displayName,
    },
  })
})

export default findContactByPhone
