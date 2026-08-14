// apps/api/src/routes/entities/find-by-value.ts

/**
 * Lambda SDK callback for `@auxx/sdk/server` `findRecordByFieldValue`.
 *
 * Reverse lookup: which record holds `value` on an app-owned field? Resolves
 * within the agent-bound connection for connection-scoped fields, so the same
 * key resolves "customer #456" only within the bound store (parent §8).
 */

import { database } from '@auxx/database'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { type LookupCandidate, lookupEntitiesByFieldValue } from '@auxx/lib/resources'
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

  // The SDK sends strings; `createTypedValueInput` does `Boolean('false') ===
  // true`, so coerce checkbox values here (matching this route's historical
  // `value === 'true'` behavior).
  const candidateValue: unknown = field.type === 'CHECKBOX' ? value === 'true' : value

  // Shared lookup core: column-aware typed match + write-path normalization
  // (EMAIL lowercased, URL protocol-prefixed, PHONE E.164 — a raw `eq` on
  // valueText could never match those), deterministic ordering. Keeps
  // include-archived, matching the historical behavior of this route.
  const result = await lookupEntitiesByFieldValue(database, {
    organizationId: auth.organizationId,
    entityDefinitionId: defId,
    candidates: [{ fieldId: field.id, value: candidateValue } as LookupCandidate],
    limit: 1,
  })
  if (result.isErr()) return c.json({ entity: null })

  const hit = result.value.items[0]
  if (!hit) return c.json({ entity: null })

  return c.json({
    entity: {
      recordId: hit.recordId,
      displayName: hit.displayName,
    },
  })
})

export default findByValue
