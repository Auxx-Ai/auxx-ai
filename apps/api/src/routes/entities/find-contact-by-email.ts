// apps/api/src/routes/entities/find-contact-by-email.ts

/**
 * Lambda SDK callback for `ctx.entities.findContactByEmail`.
 *
 * Authorized via the `entities` callback token scope minted by
 * `prepareLambdaContext` for AI tool invocations. Looks up a non-archived
 * contact-kind EntityInstance with any EMAIL FieldValue matching
 * (case-insensitive) and returns the auxx recordId (`<defId>:<instId>`)
 * plus display name. Ties resolve to the first row by ascending sortKey.
 *
 * Used by integrations that don't have a contact-import source path —
 * Slack first, Gmail next. See plans/kopilot/apps/slack-overhaul.md §6.
 */

import { database, schema } from '@auxx/database'
import { getCachedCustomFields, getCachedEntityDefId } from '@auxx/lib/cache'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const findContactByEmail = new Hono<AppContext>()

const FindContactByEmailSchema = z.object({
  email: z.string().email(),
})

findContactByEmail.post('/find-contact-by-email', async (c) => {
  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.res

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = FindContactByEmailSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }
  const email = parsed.data.email.trim().toLowerCase()
  if (!email) return c.json({ entity: null })

  // Resolve the org's contact EntityDefinition + EMAIL field ids from cache.
  const defId = await getCachedEntityDefId(auth.organizationId, 'contact')
  if (!defId) return c.json({ entity: null })

  const fields = await getCachedCustomFields(auth.organizationId, defId)
  const emailFieldIds = fields.filter((f) => f.type === 'EMAIL').map((f) => f.id)
  if (emailFieldIds.length === 0) return c.json({ entity: null })

  // Look up the EMAIL FieldValue (case-insensitive) and join to the
  // EntityInstance to return its display name.
  const row = await database
    .select({
      instanceId: schema.EntityInstance.id,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, auth.organizationId),
        eq(schema.FieldValue.entityDefinitionId, defId),
        inArray(schema.FieldValue.fieldId, emailFieldIds),
        sql`lower(${schema.FieldValue.valueText}) = ${email}`
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey), asc(schema.EntityInstance.id))
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

export default findContactByEmail
