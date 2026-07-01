// apps/api/src/routes/entities/find-by-integration-id.ts

/**
 * Lambda SDK callback for `ctx.entities.findByIntegrationId`.
 *
 * Authorized via the `entities` callback token scope minted by
 * `prepareLambdaContext` for AI tool invocations. Resolves a record from the
 * `RecordIdentity` index by `(orgId, kind, source, externalId)` and returns the
 * auxx recordId (`<defId>:<instId>`) plus the display name.
 *
 * See plans/kopilot/apps/credentials.md §3.6 and refs.md §4.1.
 */

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { findRecordByIdentity } from '@auxx/lib/identity'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const entities = new Hono<AppContext>()

const FindByIntegrationIdSchema = z.object({
  kind: z.string(),
  source: z.string(),
  externalId: z.string(),
})

entities.post('/find-by-integration-id', async (c) => {
  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.res

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = FindByIntegrationIdSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }
  const { kind, source, externalId } = parsed.data

  // `kind` is the EntityDefinition.entityType. Resolve via the org cache (one
  // defId per entityType — no ambiguity), like the sibling find-contact routes.
  const defId = await getCachedEntityDefId(auth.organizationId, kind)
  if (!defId) {
    return c.json({ entity: null })
  }

  const indexed = await findRecordByIdentity({
    organizationId: auth.organizationId,
    entityDefinitionId: defId,
    source,
    externalId,
  })
  return c.json({ entity: indexed })
})

export default entities
