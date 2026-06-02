// apps/api/src/routes/entities/find-by-value.ts

/**
 * Lambda SDK callback for `@auxx/sdk/server` `findRecordByFieldValue`.
 *
 * Reverse lookup: which record holds `value` on an app-owned field? Resolves
 * within the agent-bound connection for connection-scoped fields, so the same
 * key resolves "customer #456" only within the bound store (parent §8).
 */

import { database, schema } from '@auxx/database'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { and, eq, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'
import { resolveOwnedField } from './owned-fields'

const findByValue = new Hono<AppContext>()

const FindByValueSchema = z.object({
  targetEntity: z.string().min(1),
  fieldKey: z.string().min(1),
  value: z.string(),
})

/** Match `value` against the FieldValue column for the field's type. */
function valueCondition(fieldType: string, value: string): SQL | null {
  switch (fieldType) {
    case 'NUMBER':
    case 'CURRENCY': {
      const n = Number(value)
      return Number.isFinite(n) ? eq(schema.FieldValue.valueNumber, n) : null
    }
    case 'CHECKBOX':
      return eq(schema.FieldValue.valueBoolean, value === 'true')
    default:
      // TEXT, EMAIL, URL, PHONE_INTL, NAME, … all live in valueText.
      return eq(schema.FieldValue.valueText, value)
  }
}

findByValue.post('/find-by-value', async (c) => {
  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.res

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = FindByValueSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }
  const { targetEntity, fieldKey, value } = parsed.data

  const defId = await getCachedEntityDefId(auth.organizationId, targetEntity)
  if (!defId) return c.json({ entity: null })

  const field = await resolveOwnedField(
    {
      organizationId: auth.organizationId,
      installationId: auth.installationId,
      boundConnectionId: auth.connectionId,
      entityDefinitionId: defId,
    },
    fieldKey
  )
  if (!field) return c.json(errorResponse('FORBIDDEN', `Field not owned: ${fieldKey}`), 403)

  const condition = valueCondition(field.type, value)
  if (!condition) return c.json({ entity: null })

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
        eq(schema.FieldValue.fieldId, field.id),
        condition
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

export default findByValue
