// apps/api/src/routes/entities/get-values.ts

/**
 * Lambda SDK callback for `@auxx/sdk/server` `getFieldValue` / `getFieldValues`.
 *
 * Reads the values of the custom fields an installed app owns on a record.
 * Ownership is resolved from the org cache; a requested key the app doesn't
 * own is a 403 (it can never read a field it doesn't own). Omitting `fieldKeys`
 * returns every field the installation owns on the record's entity.
 */

import { FieldValueService, type RecordId, resolveCalcForRecord } from '@auxx/lib/field-values'
import { Hono } from 'hono'
import { z } from 'zod'
import { verifyCallbackAuth } from '../../lib/callback-auth'
import { errorResponse } from '../../lib/response'
import type { AppContext } from '../../types/context'
import {
  listOwnedFields,
  parseRecordId,
  projectFieldValue,
  resolveOwnedField,
} from './owned-fields'

const getValues = new Hono<AppContext>()

const GetValuesSchema = z.object({
  recordId: z.string().min(1),
  fieldKeys: z.array(z.string()).optional(),
})

getValues.post('/get-values', async (c) => {
  const auth = verifyCallbackAuth(c, 'entities')
  if (!auth) return c.res

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid JSON body'), 400)
  }

  const parsed = GetValuesSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(errorResponse('BAD_REQUEST', 'Invalid input'), 400)
  }
  const { recordId, fieldKeys } = parsed.data

  const record = parseRecordId(recordId)
  if (!record) return c.json(errorResponse('BAD_REQUEST', 'Invalid recordId'), 400)

  const scope = {
    organizationId: auth.organizationId,
    installationId: auth.installationId,
    boundConnectionId: auth.connectionId,
    entityDefinitionId: record.entityDefinitionId,
  }

  // Resolve owned fields (explicit keys → refuse unowned; omitted → all owned).
  // CALC fields are held aside — the plain `getValues` join has no stored row for them,
  // so they resolve through `resolveCalcForRecord` (the canonical server-side CALC evaluator)
  // instead of returning null.
  const keyByFieldId = new Map<string, string>()
  const calcFields: { fieldId: string; key: string }[] = []
  const noteField = (field: { id: string; type: string }, key: string) => {
    if (field.type === 'CALC') calcFields.push({ fieldId: field.id, key })
    else keyByFieldId.set(field.id, key)
  }
  if (fieldKeys) {
    for (const key of fieldKeys) {
      const field = await resolveOwnedField(scope, key)
      if (!field) {
        return c.json(errorResponse('FORBIDDEN', `Field not owned: ${key}`), 403)
      }
      noteField(field, key)
    }
  } else {
    for (const field of await listOwnedFields(scope)) {
      noteField(field, field.appFieldKey!)
    }
  }

  const values: Record<string, unknown> = {}
  if (keyByFieldId.size > 0 || calcFields.length > 0) {
    const service = new FieldValueService(auth.organizationId)

    if (keyByFieldId.size > 0) {
      const result = await service.getValues({
        recordId: recordId as RecordId,
        fieldIds: [...keyByFieldId.keys()],
      })
      for (const [fieldId, key] of keyByFieldId) {
        values[key] = projectFieldValue(result.get(fieldId) ?? null)
      }
    }

    for (const { fieldId, key } of calcFields) {
      const resolution = await resolveCalcForRecord(service.ctx, {
        recordId: recordId as RecordId,
        calcFieldId: fieldId,
      })
      values[key] = resolution.value
    }
  }

  return c.json({ values })
})

export default getValues
