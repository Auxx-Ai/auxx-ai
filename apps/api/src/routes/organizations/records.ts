// apps/api/src/routes/organizations/records.ts

/**
 * Reading a whole record — values plus expanded `include` relationships —
 * through `UnifiedCrudHandler.getRecords` (plans/apps/outbound/01-records-api.md
 * §2). Mounted under `/:handle` in `organizations/index.ts`, whose callback-token
 * middleware and `authMiddleware`/`organizationMiddleware` chain resolve the
 * principal before either route below runs.
 */

import { database } from '@auxx/database'
import { getCapabilities } from '@auxx/lib/permissions'
import type { ReadOptions, RecordNode } from '@auxx/lib/resources'
import { UnifiedCrudHandler } from '@auxx/lib/resources'
import { isRecordId, type RecordId } from '@auxx/types/resource'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'
import { projectFieldValue } from '../entities/owned-fields'

const records = new Hono<AppContext>()

const MAX_RECORD_IDS = 100

/** Recursive `ReadOptions` body shape — depth is whatever the caller nests. */
interface ReadOptionsInput {
  fields?: string[]
  include?: Record<string, ReadOptionsInput>
}

const readOptionsSchema: z.ZodType<ReadOptionsInput> = z.lazy(() =>
  z.object({
    fields: z.array(z.string()).optional(),
    include: z.record(z.string(), readOptionsSchema).optional(),
  })
)

const readBodySchema = z.object({
  recordIds: z.array(z.string().min(1)).max(MAX_RECORD_IDS),
  fields: z.array(z.string()).optional(),
  include: z.record(z.string(), readOptionsSchema).optional(),
})

/** Project a `RecordNode` (server-internal `TypedFieldValue`s) to the wire shape `get-values.ts` already uses for app-facing reads. */
function projectRecordNode(node: RecordNode): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.values)) {
    values[key] = projectFieldValue(value)
  }
  const included: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.included)) {
    included[key] = Array.isArray(value) ? value.map(projectRecordNode) : projectRecordNode(value)
  }
  return {
    recordId: node.recordId,
    entityDefinitionId: node.entityDefinitionId,
    displayName: node.displayName,
    values,
    included,
    redacted: node.redacted,
  }
}

async function buildHandler(c: Context<AppContext>) {
  const organizationId = c.get('organizationId')
  const userId = c.get('userId')
  const capabilities = await getCapabilities(userId, organizationId)
  return new UnifiedCrudHandler(organizationId, userId, database, undefined, { capabilities })
}

/**
 * GET /:handle/records/:recordId?fields=a,b&include={"line_items":{}}
 * A record the principal can't see is a 404, never 403 — same
 * non-enumeration contract as every other record read in this codebase.
 */
records.get('/records/:recordId', async (c) => {
  const recordId = c.req.param('recordId')
  if (!isRecordId(recordId)) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid recordId'), 400)
  }

  const opts: ReadOptions = {}
  const fieldsParam = c.req.query('fields')
  if (fieldsParam) {
    // Boundary cast: `fields` is caller-supplied text; ReadOptions narrows it
    // to FieldId | SystemAttribute only for callers inside `packages/lib`.
    opts.fields = fieldsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as ReadOptions['fields']
  }
  const includeParam = c.req.query('include')
  if (includeParam) {
    let parsed: unknown
    try {
      parsed = JSON.parse(includeParam)
    } catch {
      return c.json(errorResponse('BAD_REQUEST', 'include must be JSON'), 400)
    }
    const result = z.record(z.string(), readOptionsSchema).safeParse(parsed)
    if (!result.success) return c.json(errorResponse('BAD_REQUEST', 'Invalid include'), 400)
    opts.include = result.data as ReadOptions['include']
  }

  const handler = await buildHandler(c)
  const node = await handler.getRecord(recordId as RecordId, opts)
  if (!node) return c.json(errorResponse('NOT_FOUND', 'Record not found'), 404)
  return c.json(projectRecordNode(node))
})

/**
 * POST /:handle/records/read
 * body: { recordIds, fields?, include? } — the batch form, for an `include`
 * tree that doesn't fit a query string. Caps `recordIds` at 100 and rejects
 * over it (400) rather than truncating; an empty batch returns `{}`.
 */
records.post('/records/read', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = readBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }
  const { recordIds, fields, include } = parsed.data
  if (!recordIds.every(isRecordId)) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid recordId'), 400)
  }

  const handler = await buildHandler(c)
  const nodes = await handler.getRecords(
    recordIds as RecordId[],
    { fields, include } as ReadOptions
  )

  const result: Record<string, unknown> = {}
  for (const [recordId, node] of Object.entries(nodes)) {
    result[recordId] = projectRecordNode(node)
  }
  return c.json(result)
})

export default records
