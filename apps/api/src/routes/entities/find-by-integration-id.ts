// apps/api/src/routes/entities/find-by-integration-id.ts

/**
 * Lambda SDK callback for `ctx.entities.findByIntegrationId`.
 *
 * Authorized via the `entities` callback token scope minted by
 * `prepareLambdaContext` for AI tool invocations. Looks up an
 * `EntityInstance` by `(orgId, kind, integrationSource, externalId)` and
 * returns the auxx recordId (`<defId>:<instId>`) plus the display name.
 *
 * Schema dependency: `EntityInstance.integrationSource` + `externalId` +
 * composite index — already shipped in the Wedge A migration.
 *
 * See plans/kopilot/apps/credentials.md §3.6 and refs.md §4.1.
 */

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'

const entities = new Hono<AppContext>()

/** Map of refs.entity('<kind>') → EntityDefinition selector */
const KIND_TO_SELECTOR: Record<string, { entityType?: string; standardType?: string }> = {
  contact: { entityType: 'contact' },
  company: { standardType: 'company' },
  deal: { standardType: 'deal' },
  ticket: { entityType: 'ticket' },
  task: { standardType: 'task' },
  user: { entityType: 'user' },
  thread: { entityType: 'thread' },
  article: { entityType: 'article' },
}

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

  const selector = KIND_TO_SELECTOR[kind]
  if (!selector) {
    return c.json(errorResponse('BAD_REQUEST', `Unsupported kind: ${kind}`), 400)
  }

  // Resolve the org's EntityDefinition for this semantic kind.
  // Asserts findOne semantics — see plans/kopilot/apps/refs.md §11.
  const defConditions = [eq(schema.EntityDefinition.organizationId, auth.organizationId)]
  if (selector.entityType) {
    defConditions.push(eq(schema.EntityDefinition.entityType, selector.entityType))
  }
  if (selector.standardType) {
    defConditions.push(eq(schema.EntityDefinition.standardType, selector.standardType))
  }
  const defs = await database.query.EntityDefinition.findMany({
    where: and(...defConditions),
    columns: { id: true },
  })
  if (defs.length === 0) {
    return c.json({ entity: null })
  }
  if (defs.length > 1) {
    // Loud failure rather than silent winner-pick.
    return c.json(
      errorResponse('AMBIGUOUS_DEFINITION', `Multiple entity defs match kind '${kind}'`),
      500
    )
  }
  const defId = defs[0]!.id

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
