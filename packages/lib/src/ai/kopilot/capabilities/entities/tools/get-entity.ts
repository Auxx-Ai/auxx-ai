// packages/lib/src/ai/kopilot/capabilities/entities/tools/get-entity.ts

import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { RecordPickerService } from '../../../../../resources/picker'
import { isRecordId, parseRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { GetEntityDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { enrichEntitiesWithFieldValues } from '../enrich-entity-fields'
import { formatEnrichedFields } from '../format-enriched-fields'

const logger = createScopedLogger('kopilot-get-entity')

export function createGetEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_entity',
    idempotent: true,
    outputBlock: 'entity-card',
    outputDigestSchema: GetEntityDigest,
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
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as string

      if (!isRecordId(recordId)) {
        return {
          success: false,
          output: null,
          error: `Invalid recordId format "${recordId}". Expected "entityDefinitionId:entityInstanceId".`,
        }
      }

      const pickerService = new RecordPickerService(agentDeps.organizationId, agentDeps.userId, db)
      const items = await pickerService.getResourcesByIds([recordId])
      const item = items[recordId]

      const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

      if (item) {
        const enriched = await enrichEntitiesWithFieldValues({
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
          db,
          entities: [{ recordId, entityDefinitionId, entityInstanceId }],
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

      // Fallback: direct DB lookup when picker service fails (e.g. cache miss)
      const instance = await db.query.EntityInstance.findFirst({
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
