// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-field-changes.ts

import { schema } from '@auxx/database'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { getCachedMembersByUserIds } from '../../../../../cache/org-cache-helpers'
import type {
  TimelineFieldChangeSnapshot,
  TimelineFieldChangeSnapshotValue,
} from '../../../../../timeline/field-change-snapshot'
import { parseStringArg } from '../../../../agent-framework/tool-inputs'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListFieldChangesDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

const MAX_LIMIT = 50

/** Field-update event types across system + custom entities. */
const FIELD_UPDATE_EVENT_TYPES = [
  'contact:field:updated',
  'ticket:field:updated',
  'entity:field:updated',
]

/** Reduce a snapshot value to a short human-readable string for the digest. */
function snapshotToDisplay(value: TimelineFieldChangeSnapshotValue): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    return value
      .map(snapshotItemToDisplay)
      .filter((s): s is string => Boolean(s))
      .join(', ')
  }
  return snapshotItemToDisplay(value)
}

function snapshotItemToDisplay(snap: TimelineFieldChangeSnapshot): string {
  switch (snap.fieldType) {
    case 'TEXT':
    case 'EMAIL':
    case 'URL':
    case 'NAME':
    case 'PHONE_INTL':
      return snap.text
    case 'RICH_TEXT':
      return snap.html.replace(/<[^>]+>/g, '').trim()
    case 'NUMBER':
    case 'CURRENCY':
      return snap.formatted
    case 'CHECKBOX':
      return snap.value ? 'true' : 'false'
    case 'DATE':
    case 'DATETIME':
    case 'TIME':
      return snap.iso
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
    case 'TAGS':
      return snap.label
    case 'RELATIONSHIP':
      return snap.label
    case 'ACTOR':
      return snap.label
    case 'FILE':
      return snap.label
    case 'JSON':
    case 'ADDRESS_STRUCT':
      return JSON.stringify(snap.value)
    default:
      return null as never
  }
}

export function createListFieldChangesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_field_changes',
    outputDigestSchema: ListFieldChangesDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        changes?: Array<{
          fieldSystemAttribute?: string
          oldDisplay?: unknown
          newDisplay?: unknown
        }>
      }
      const changes = Array.isArray(out.changes) ? out.changes : []
      return {
        count: changes.length,
        sample: takeSample(changes).map((c) => ({
          fieldKey: typeof c.fieldSystemAttribute === 'string' ? c.fieldSystemAttribute : '',
          oldValue: c.oldDisplay ?? undefined,
          newValue: c.newDisplay ?? undefined,
        })),
      }
    },
    idempotent: true,
    description:
      'Return recent custom-field changes on an entity (e.g. stage progression, owner changes). Reads from timeline events.',
    parameters: {
      type: 'object',
      properties: {
        entityInstanceId: {
          type: 'string',
          description: 'EntityInstance ID (just the instance id, not a full recordId).',
        },
        fieldSystemAttribute: {
          type: 'string',
          description:
            'Optional filter: a field system attribute (e.g. "stage", "owner") to narrow results to a single field. Omit to return changes across all fields.',
        },
        sinceDays: {
          type: 'number',
          description: 'Look back this many days (default 90).',
        },
        limit: {
          type: 'number',
          description: `Max results (default 20, max ${MAX_LIMIT}).`,
        },
      },
      required: ['entityInstanceId'],
      additionalProperties: false,
    },
    validateInputs: async (args) => {
      const entityInstanceId = parseStringArg(args.entityInstanceId, {
        name: 'entityInstanceId',
        required: true,
        max: 200,
      })
      if (!entityInstanceId.ok) return { ok: false, error: entityInstanceId.error }
      return { ok: true, args: { ...args, entityInstanceId: entityInstanceId.value } }
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const entityInstanceId = args.entityInstanceId as string
      const fieldFilter = (args.fieldSystemAttribute as string | undefined) || undefined
      const sinceDays = (args.sinceDays as number | undefined) ?? 90
      const limit = Math.min((args.limit as number) ?? 20, MAX_LIMIT)
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

      const events = await db
        .select({
          id: schema.TimelineEvent.id,
          startedAt: schema.TimelineEvent.startedAt,
          actorId: schema.TimelineEvent.actorId,
          actorType: schema.TimelineEvent.actorType,
          changes: schema.TimelineEvent.changes,
        })
        .from(schema.TimelineEvent)
        .where(
          and(
            eq(schema.TimelineEvent.organizationId, agentDeps.organizationId),
            eq(schema.TimelineEvent.entityId, entityInstanceId),
            inArray(schema.TimelineEvent.eventType, FIELD_UPDATE_EVENT_TYPES),
            gte(schema.TimelineEvent.startedAt, since)
          )
        )
        .orderBy(desc(schema.TimelineEvent.startedAt))
        .limit(limit * 2) // overshoot — events may carry multiple changes; we cap rows below

      // Resolve user-actor names from cache for "by" attribution.
      const userIds = Array.from(
        new Set(
          events.filter((e) => e.actorType === 'user' && e.actorId).map((e) => e.actorId as string)
        )
      )
      const members = userIds.length
        ? await getCachedMembersByUserIds(agentDeps.organizationId, userIds)
        : []
      const nameByUserId = new Map(members.map((m) => [m.userId, m.user?.name ?? null]))

      const rows: Array<{
        fieldSystemAttribute: string
        oldDisplay: string | null
        newDisplay: string | null
        at: string
        by: { actorType: string | null; userId: string | null; name: string | null }
      }> = []

      for (const e of events) {
        const changes = (e.changes ?? []) as Array<{
          field: string
          oldDisplay?: TimelineFieldChangeSnapshotValue
          newDisplay?: TimelineFieldChangeSnapshotValue
        }>
        for (const c of changes) {
          if (fieldFilter && c.field !== fieldFilter) continue
          rows.push({
            fieldSystemAttribute: c.field,
            oldDisplay: snapshotToDisplay(c.oldDisplay ?? null),
            newDisplay: snapshotToDisplay(c.newDisplay ?? null),
            at: e.startedAt.toISOString(),
            by: {
              actorType: e.actorType,
              userId: e.actorType === 'user' ? e.actorId : null,
              name:
                e.actorType === 'user' && e.actorId ? (nameByUserId.get(e.actorId) ?? null) : null,
            },
          })
          if (rows.length >= limit) break
        }
        if (rows.length >= limit) break
      }

      return {
        success: true,
        output: { changes: rows },
      }
    },
  }
}
