// packages/lib/src/ai/kopilot/capabilities/entities/tools/get-entity.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { RecordPickerService } from '../../../../../resources/picker'
import { parseRecordId } from '../../../../../resources/resource-id'
import { getKnownDefIds, normalizeRecordIdArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { enrichEntitiesWithFieldValues } from '../enrich-entity-fields'
import { FormattedFieldSchema, formatEnrichedFields } from '../format-enriched-fields'

const logger = createScopedLogger('kopilot-get-entity')

/** Full success output of `get_entity` — one enriched record. */
const GetEntityOutput = z.object({
  recordId: z.string(),
  displayName: z.string(),
  secondaryInfo: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  fields: z.record(z.string(), FormattedFieldSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export function createGetEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_entity',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: 'canViewEntity on the recordId’s def before the read.',
    },
    displayName: 'Get record',
    toolsetSlug: 'auxx:entities:search',
    category: 'system',
    idempotent: true,
    outputSchema: GetEntityOutput,
    exampleOutput: {
      recordId: 'contact:9aB3xY',
      displayName: 'Jane Cooper',
      secondaryInfo: 'jane@example.com',
      avatarUrl: null,
      fields: {
        Email: { text: 'jane@example.com', type: 'email' },
        Phone: { text: '+1 555 0142', type: 'phone' },
        Status: { text: 'Active', type: 'tags', tags: [{ label: 'Active', color: 'green' }] },
      },
      createdAt: new Date('2026-01-12T08:30:00.000Z'),
      updatedAt: new Date('2026-06-05T14:22:00.000Z'),
    } satisfies z.output<typeof GetEntityOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        recordId?: string
        displayName?: string
        secondaryInfo?: string | null
      }
      const recordId = String(out.recordId ?? '')
      return {
        recordId,
        entityDefinitionId: recordId.split(':')[0] || undefined,
        displayName: typeof out.displayName === 'string' ? out.displayName : recordId,
        secondary: typeof out.secondaryInfo === 'string' ? out.secondaryInfo : undefined,
      }
    },
    description:
      'Get detailed information about a specific entity instance including all field values. Use when you need to read specific field data, not just display the record.',
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId)',
        },
      },
      required: ['recordId'],
      additionalProperties: false,
    },
    validateInputs: async (args, ctx) => {
      const known = await getKnownDefIds(ctx.organizationId)
      const recordId = normalizeRecordIdArg(args.recordId, {
        knownDefIds: known,
        argName: 'recordId',
      })
      if (!recordId.ok) return { ok: false, error: recordId.error }
      return {
        ok: true,
        args: { ...args, recordId: recordId.value },
        warnings: recordId.warnings,
      }
    },
    execute: async (args, agentDeps) => {
      const { db, capabilities } = getDeps()
      const recordId = args.recordId as string

      // Read enforcement (§3): the picker drops non-viewable defs, so `item` is
      // absent for a restricted record. The gate is re-applied before the
      // direct-DB fallback below so a restricted def can't leak through it.
      const pickerService = new RecordPickerService(
        agentDeps.organizationId,
        agentDeps.userId,
        db,
        capabilities
      )
      const items = await pickerService.getResourcesByIds([recordId])
      const item = items[recordId]

      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
      const canView = !capabilities || capabilities.canViewEntity(entityDefinitionId)

      if (item) {
        const enriched = await enrichEntitiesWithFieldValues({
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
          db,
          entities: [{ recordId, entityDefinitionId, entityInstanceId }],
          capabilities,
        })
        return {
          success: true,
          output: {
            recordId: item.recordId,
            displayName: item.displayName,
            secondaryInfo: item.secondaryInfo ?? null,
            avatarUrl: item.avatarUrl ?? null,
            fields: formatEnrichedFields(enriched.get(recordId) ?? {}),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
        }
      }

      // Fallback: direct DB lookup when picker service fails (e.g. cache miss).
      // Skip it for a restricted def so the fallback can't bypass enforcement.
      const instance = !canView
        ? null
        : await db.query.EntityInstance.findFirst({
            where: and(
              eq(schema.EntityInstance.id, entityInstanceId),
              eq(schema.EntityInstance.organizationId, agentDeps.organizationId),
              eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
            ),
          })

      if (instance) {
        logger.warn('Entity found via direct DB lookup but not via picker service', {
          recordId,
          organizationId: agentDeps.organizationId,
        })
        const enriched = await enrichEntitiesWithFieldValues({
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
          db,
          entities: [{ recordId, entityDefinitionId, entityInstanceId }],
          capabilities,
        })
        return {
          success: true,
          output: {
            recordId,
            displayName: instance.displayName || entityInstanceId,
            secondaryInfo: instance.secondaryDisplayValue ?? null,
            avatarUrl: instance.avatarUrl ?? null,
            fields: formatEnrichedFields(enriched.get(recordId) ?? {}),
            createdAt: instance.createdAt,
            updatedAt: instance.updatedAt,
          },
        }
      }

      return {
        success: false,
        output: null,
        error: `Record "${recordId}" not found.`,
      }
    },
  }
}
