// apps/api/src/routes/entities/set-values.ts

/**
 * Lambda SDK callback for `@auxx/sdk/server` `setFieldValues`.
 *
 * Writes the values of the custom fields an installed app owns. Accepts a
 * per-record entries array (single-record writes are a one-entry array).
 * Ownership is resolved from the org cache; an unowned key fails the whole
 * call with 403 before any write. Writes are attributed to the org system
 * user.
 *
 * App fields are `updatable: false` to block *user* edits (a frontend
 * affordance) — there is no server-side updatable guard on `FieldValueService`,
 * so the owning app writes them directly here, authorized purely by ownership.
 *
 * Multi-value note: writes are replace-only (`applyBulk` mode defaults to
 * `'set'` — a multi-value field's whole stored list is replaced). This is safe
 * here because only app-OWNED fields are reachable: the seeded multi-capable
 * fields (contact `primary_email`/`phone`, company `website`) are org-owned
 * and can never resolve through `resolveOwnedField`. If an app ever needs
 * append semantics on its own multi field, thread an optional per-key `mode`
 * through to `applyBulk`'s `BulkValueItem.mode`.
 */

import { getOrgCache } from '@auxx/lib/cache'
import { FieldValueService } from '@auxx/lib/field-values'
import type { RecordId } from '@auxx/types/resource'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'
import { parseRecordId, resolveOwnedField } from './owned-fields'

const setValues = new Hono<AppContext>()

const SetValuesSchema = z.object({
  entries: z
    .array(
      z.object({
        recordId: z.string().min(1),
        values: z.record(z.string(), z.unknown()),
      })
    )
    .min(1),
})

setValues.post('/set-values', async (c) => {
  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.res

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = SetValuesSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }
  const { entries } = parsed.data

  // Resolve every (record, key) to an owned fieldId first — an unowned key
  // fails the whole call before any write.
  const resolved: Array<{ recordId: string; values: Array<{ fieldId: string; value: unknown }> }> =
    []
  for (const entry of entries) {
    const record = parseRecordId(entry.recordId)
    if (!record)
      return c.json(errorResponse('BAD_REQUEST', `Invalid recordId: ${entry.recordId}`), 400)

    const scope = {
      organizationId: auth.organizationId,
      installationId: auth.installationId,
      boundConnectionId: auth.connectionId,
      entityDefinitionId: record.entityDefinitionId,
    }

    const values: Array<{ fieldId: string; value: unknown }> = []
    for (const [key, value] of Object.entries(entry.values)) {
      const field = await resolveOwnedField(scope, key)
      if (!field) {
        return c.json(errorResponse('FORBIDDEN', `Field not owned: ${key}`), 403)
      }
      values.push({ fieldId: field.id, value })
    }
    resolved.push({ recordId: entry.recordId, values })
  }

  // Attribute writes to the org system user; realtime echo-suppression is
  // web-only, so no socketId. Per-record value maps go through the shared
  // applyBulk orchestration (mode defaults to 'set').
  const systemUserId = await getOrgCache().get(auth.organizationId, 'systemUser')
  const service = new FieldValueService(auth.organizationId, systemUserId)

  await service.applyBulk({
    items: resolved.map((entry) => ({
      recordId: entry.recordId as RecordId,
      values: entry.values,
    })),
  })

  return c.json({ ok: true })
})

export default setValues
