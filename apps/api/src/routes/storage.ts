// apps/api/src/routes/storage.ts

/**
 * @fileoverview App KV storage routes for Auxx.ai apps.
 *
 * Backs the `@auxx/sdk/server` `storage` surface (get/set/setIfAbsent/remove/
 * list) from the Lambda runtime. Rows live in `AppStorage`, scoped by
 * installation (default) or connection (explicit), bucketed by `collection`.
 *
 * Auth mirrors `settings.ts`: `verifyCallbackAuth(c, 'storage')` +
 * `X-App-Installation-Id`. Connection-scoped calls additionally carry
 * `X-App-Connection-Id`; the row is verified to belong to this installation
 * before use (defense in depth — the header comes from trusted host code).
 *
 * @module routes/storage
 */

import { database } from '@auxx/database'
import {
  deleteAppStorageValue,
  getAppStorageValue,
  listAppStorageValues,
  setAppStorageValue,
  setAppStorageValueIfAbsent,
} from '@auxx/lib/apps'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../lib/callback-auth'
import { ERROR_STATUS_MAP, errorResponse } from '../lib/response'
import type { AppContext } from '../types/context'

const storage = new Hono<AppContext>()

/** Map a lib query error (AuxxError) to a JSON error response. */
function resultError(c: Context<AppContext>, error: Error) {
  const status = (error as { statusCode?: number }).statusCode ?? 500
  return c.json(errorResponse(error.name, error.message), status as never)
}

/** Max TTL: 30 days (matches the SDK guard). */
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60

const putItemSchema = z.object({
  value: z.unknown(),
  ttlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS).optional(),
  collection: z.string().optional(),
  ifAbsent: z.boolean().optional(),
})

/**
 * Resolve the scope tuple for a request. Returns the resolved `connectionId`
 * (null = installation scope) or an error response when the connection header
 * is present but the row doesn't belong to this installation.
 */
async function resolveConnectionId(
  c: Context<AppContext>,
  auth: { installationId: string; organizationId: string }
): Promise<{ connectionId: string | null } | { error: Response }> {
  const headerConnectionId = c.req.header('X-App-Connection-Id')
  if (!headerConnectionId) return { connectionId: null }

  const credential = await database.query.Credential.findFirst({
    where: (cred, { eq }) => eq(cred.id, headerConnectionId),
    columns: { id: true, organizationId: true, appInstallationId: true },
  })

  // The credential must exist and be bound to this installation (which already
  // ties it to one app + org). When the token carries an org, assert it too.
  if (
    !credential ||
    credential.appInstallationId !== auth.installationId ||
    (auth.organizationId && credential.organizationId !== auth.organizationId)
  ) {
    return {
      error: c.json(errorResponse('FORBIDDEN', 'Connection not found for this installation'), 403),
    }
  }

  return { connectionId: credential.id }
}

/**
 * GET /api/v1/sdk/storage/item/:key?collection=
 * Read a single value. `{ item: { value } | null }` — null = missing or expired.
 */
storage.get('/item/:key', async (c) => {
  try {
    const auth = verifyCallbackAuth(c, 'storage')
    if (!auth) return c.res

    const scope = await resolveConnectionId(c, auth)
    if ('error' in scope) return scope.error

    const key = c.req.param('key')
    const collection = c.req.query('collection') ?? ''

    const result = await getAppStorageValue(
      auth.installationId,
      scope.connectionId,
      collection,
      key
    )
    if (result.isErr()) {
      return resultError(c, result.error)
    }

    return c.json({ success: true, data: { item: result.value } })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * PUT /api/v1/sdk/storage/item/:key
 * Upsert (or insert-if-absent with `ifAbsent`). Body:
 * `{ value, ttlSeconds?, collection?, ifAbsent? }`.
 */
storage.put('/item/:key', async (c) => {
  try {
    const auth = verifyCallbackAuth(c, 'storage')
    if (!auth) return c.res

    const body = putItemSchema.parse(await c.req.json())
    const scope = await resolveConnectionId(c, auth)
    if ('error' in scope) return scope.error

    const key = c.req.param('key')
    const collection = body.collection ?? ''
    const expiresAt = body.ttlSeconds ? new Date(Date.now() + body.ttlSeconds * 1000) : null

    if (body.ifAbsent) {
      const result = await setAppStorageValueIfAbsent(
        auth.installationId,
        scope.connectionId,
        collection,
        key,
        body.value,
        expiresAt
      )
      if (result.isErr()) {
        const status = ERROR_STATUS_MAP[result.error.name] || 500
        return c.json(errorResponse(result.error.name, result.error.message), status)
      }
      return c.json({ success: true, data: { created: result.value } })
    }

    const result = await setAppStorageValue(
      auth.installationId,
      scope.connectionId,
      collection,
      key,
      body.value,
      expiresAt
    )
    if (result.isErr()) {
      return resultError(c, result.error)
    }

    return c.json({ success: true, data: { success: true } })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * DELETE /api/v1/sdk/storage/item/:key?collection=
 * Idempotent delete — 200 even when the key is absent.
 */
storage.delete('/item/:key', async (c) => {
  try {
    const auth = verifyCallbackAuth(c, 'storage')
    if (!auth) return c.res

    const scope = await resolveConnectionId(c, auth)
    if ('error' in scope) return scope.error

    const key = c.req.param('key')
    const collection = c.req.query('collection') ?? ''

    const result = await deleteAppStorageValue(
      auth.installationId,
      scope.connectionId,
      collection,
      key
    )
    if (result.isErr()) {
      return resultError(c, result.error)
    }

    return c.json({ success: true, data: { success: true } })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

/**
 * GET /api/v1/sdk/storage/list?collection=&limit=
 * Enumerate a collection (required). `{ entries: [{ key, value }] }`.
 */
storage.get('/list', async (c) => {
  try {
    const auth = verifyCallbackAuth(c, 'storage')
    if (!auth) return c.res

    const collection = c.req.query('collection')
    if (!collection) {
      return c.json(errorResponse('BAD_REQUEST', 'collection is required'), 400)
    }

    const scope = await resolveConnectionId(c, auth)
    if ('error' in scope) return scope.error

    const limitParam = c.req.query('limit')
    const limit = limitParam ? Number(limitParam) : undefined

    const result = await listAppStorageValues(
      auth.installationId,
      scope.connectionId,
      collection,
      Number.isFinite(limit) ? limit : undefined
    )
    if (result.isErr()) {
      return resultError(c, result.error)
    }

    return c.json({ success: true, data: { entries: result.value } })
  } catch (error: any) {
    const status = ERROR_STATUS_MAP[error.code] || 500
    return c.json(errorResponse(error.code || 'INTERNAL_ERROR', error.message), status)
  }
})

export default storage
