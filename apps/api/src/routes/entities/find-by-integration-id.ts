// apps/api/src/routes/entities/find-by-integration-id.ts

/**
 * Lambda SDK callback for `ctx.entities.findByIntegrationId`.
 *
 * Authorized via the `entities` callback token scope minted by
 * `prepareLambdaContext` for AI tool invocations. Looks up a record by
 * `(orgId, kind, integrationSource, externalId)` and returns the auxx
 * recordId (`<defId>:<instId>`) plus the display name.
 *
 * Dual-read (plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md
 * Phase 1): tries the `RecordIdentity` index first, then falls back to the
 * legacy `EntityInstance.integrationSource`/`externalId` columns. The index
 * has no writers yet (Phases 2-4), so today this always falls through — the
 * dual-read is what lets those later phases light this route up with zero
 * further changes here. Drop the fallback once the Phase-6 backfill lands.
 *
 * See plans/kopilot/apps/credentials.md §3.6 and refs.md §4.1.
 */

import { database, schema } from '@auxx/database'
import { getCachedEntityDefId } from '@auxx/lib/cache'
import { findRecordByIdentity } from '@auxx/lib/identity'
import { and, eq } from 'drizzle-orm'
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
  if (indexed) {
    return c.json({ entity: indexed })
  }

  const instance = await database.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.organizationId, auth.organizationId),
      eq(schema.EntityInstance.entityDefinitionId, defId),
      eq(schema.EntityInstance.integrationSource, source),
      eq(schema.EntityInstance.externalId, externalId)
    ),
    columns: { id: true, displayName: true },
  })

  if (!instance) {
    return c.json({ entity: null })
  }
  return c.json({
    entity: {
      recordId: `${defId}:${instance.id}`,
      displayName: instance.displayName,
    },
  })
})

export default entities
