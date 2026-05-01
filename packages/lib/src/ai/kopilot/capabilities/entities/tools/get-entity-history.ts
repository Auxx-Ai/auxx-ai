// packages/lib/src/ai/kopilot/capabilities/entities/tools/get-entity-history.ts

import { schema } from '@auxx/database'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { getCachedMembersByUserIds } from '../../../../../cache/org-cache-helpers'
import type {
  TimelineFieldChangeSnapshot,
  TimelineFieldChangeSnapshotValue,
} from '../../../../../timeline/field-change-snapshot'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const FIELD_UPDATE_EVENT_TYPES = [
  'contact:field:updated',
  'ticket:field:updated',
  'entity:field:updated',
]

const ALL_CATEGORIES = [
  'threads',
  'comments',
  'timeline',
  'tasks',
  'field_changes',
  'related',
  'meetings',
] as const
type Category = (typeof ALL_CATEGORIES)[number]

const SNIPPET_CHARS = 200
const COMMENT_CHARS = 200
const TIMELINE_PAYLOAD_CHARS = 200

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

function snapshotItemToDisplay(snap: TimelineFieldChangeSnapshot): string | null {
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
    case 'RELATIONSHIP':
    case 'ACTOR':
    case 'FILE':
      return snap.label
    case 'JSON':
    case 'ADDRESS_STRUCT':
      return JSON.stringify(snap.value)
    default:
      return null
  }
}

export function createGetEntityHistoryTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_entity_history',
    idempotent: true,
    description:
      "Returns a token-bounded recent-activity digest for a CRM record (contact, company, deal, lead, ticket, custom) — covers threads, comments, timeline, tasks, related entities, and meetings. Use when the user asks for an overview/summary of a record, or when you need cross-category context that isn't tied to a single thread. NOT for email reply workflows: when the user wants to draft, send, or respond to a thread, use `find_threads` → `get_thread_detail` → `draft_reply`/`send_reply` — those return full message bodies that this digest truncates.",
    parameters: {
      type: 'object',
      properties: {
        entityInstanceId: {
          type: 'string',
          description: 'EntityInstance ID (just the instance id, not a full recordId).',
        },
        sinceDays: {
          type: 'number',
          description: 'Look back this many days (default 90).',
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: [...ALL_CATEGORIES],
          },
          description: 'Categories to include. Defaults to all categories.',
        },
        maxItemsPerCategory: {
          type: 'number',
          description: 'Cap per category (default 5).',
        },
      },
      required: ['entityInstanceId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const entityInstanceId = args.entityInstanceId as string
      const sinceDays = (args.sinceDays as number | undefined) ?? 90
      const includeArg = args.include as Category[] | undefined
      const include = new Set<Category>(includeArg?.length ? includeArg : ALL_CATEGORIES)
      const cap = (args.maxItemsPerCategory as number | undefined) ?? 5
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

      // Resolve the entity itself first — gives us entityDefinitionId for downstream use,
      // and basic display info for the digest header.
      const instance = await db.query.EntityInstance.findFirst({
        where: and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, agentDeps.organizationId)
        ),
      })

      if (!instance) {
        return {
          success: false,
          output: null,
          error: `EntityInstance ${entityInstanceId} not found.`,
        }
      }

      // -------------------- run all category queries in parallel --------------------
      const truncated: Record<string, boolean> = {}

      const threadsP = include.has('threads')
        ? loadThreads(db, agentDeps.organizationId, entityInstanceId, cap, truncated)
        : Promise.resolve([])

      const commentsP = include.has('comments')
        ? loadComments(db, agentDeps.organizationId, entityInstanceId, cap, truncated)
        : Promise.resolve([])

      const timelineP = include.has('timeline')
        ? loadTimeline(db, agentDeps.organizationId, entityInstanceId, cap, since, truncated)
        : Promise.resolve([])

      const tasksP = include.has('tasks')
        ? loadOpenTasks(db, agentDeps.organizationId, entityInstanceId, cap, truncated)
        : Promise.resolve([])

      const fieldChangesP = include.has('field_changes')
        ? loadFieldChanges(db, agentDeps.organizationId, entityInstanceId, cap, since, truncated)
        : Promise.resolve([])

      const meetingsP = include.has('meetings')
        ? loadMeetings(db, agentDeps.organizationId, entityInstanceId, cap, since, truncated)
        : Promise.resolve([])

      const [
        threads,
        recentComments,
        recentTimelineEvents,
        openTasks,
        recentFieldChanges,
        meetings,
      ] = await Promise.all([threadsP, commentsP, timelineP, tasksP, fieldChangesP, meetingsP])

      // related-entities walks the threads we just loaded — must run after.
      const relatedEntities = include.has('related')
        ? await loadRelatedViaThreads(
            db,
            agentDeps.organizationId,
            entityInstanceId,
            threads.map((t) => t.id),
            cap,
            truncated
          )
        : []

      // Resolve actor names once for comments + field_changes + timeline.
      const userIds = new Set<string>()
      for (const c of recentComments) if (c.byUserId) userIds.add(c.byUserId)
      for (const f of recentFieldChanges) if (f.byUserId) userIds.add(f.byUserId)
      for (const t of recentTimelineEvents) if (t.byUserId) userIds.add(t.byUserId)
      const memberArr = userIds.size
        ? await getCachedMembersByUserIds(agentDeps.organizationId, [...userIds])
        : []
      const nameByUserId = new Map(memberArr.map((m) => [m.userId, m.user?.name ?? null]))
      for (const c of recentComments)
        c.by = c.byUserId ? (nameByUserId.get(c.byUserId) ?? null) : null
      for (const f of recentFieldChanges)
        f.by = f.byUserId ? (nameByUserId.get(f.byUserId) ?? null) : null
      for (const t of recentTimelineEvents)
        t.by = t.byUserId ? (nameByUserId.get(t.byUserId) ?? null) : null

      const wasTruncated = Object.values(truncated).some(Boolean)

      return {
        success: true,
        output: {
          entity: {
            id: instance.id,
            entityDefinitionId: instance.entityDefinitionId,
            primaryDisplay: instance.displayName ?? null,
            secondaryDisplay: instance.secondaryDisplayValue ?? null,
            createdAt: instance.createdAt.toISOString(),
            lastActivityAt: instance.lastActivityAt ? instance.lastActivityAt.toISOString() : null,
          },
          threads,
          recentComments,
          recentTimelineEvents,
          openTasks,
          recentFieldChanges,
          relatedEntities,
          meetings,
          truncated: wasTruncated,
        },
      }
    },
  }
}

// =============================================================================
// Category loaders
// =============================================================================

type Db = ReturnType<GetToolDeps>['db']

async function loadThreads(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  cap: number,
  truncated: Record<string, boolean>
) {
  // Primary-linked threads + secondary-linked threads, deduped.
  const primary = await db
    .select({
      id: schema.Thread.id,
      subject: schema.Thread.subject,
      lastMessageAt: schema.Thread.lastMessageAt,
      messageCount: schema.Thread.messageCount,
      latestMessageId: schema.Thread.latestMessageId,
    })
    .from(schema.Thread)
    .where(
      and(
        eq(schema.Thread.organizationId, organizationId),
        eq(schema.Thread.primaryEntityInstanceId, entityInstanceId)
      )
    )
    .orderBy(desc(schema.Thread.lastMessageAt))
    .limit(cap + 1)

  const secondary = await db
    .select({
      id: schema.Thread.id,
      subject: schema.Thread.subject,
      lastMessageAt: schema.Thread.lastMessageAt,
      messageCount: schema.Thread.messageCount,
      latestMessageId: schema.Thread.latestMessageId,
    })
    .from(schema.Thread)
    .innerJoin(schema.ThreadEntityLink, eq(schema.ThreadEntityLink.threadId, schema.Thread.id))
    .where(
      and(
        eq(schema.Thread.organizationId, organizationId),
        eq(schema.ThreadEntityLink.entityInstanceId, entityInstanceId),
        isNull(schema.ThreadEntityLink.unlinkedAt)
      )
    )
    .orderBy(desc(schema.Thread.lastMessageAt))
    .limit(cap + 1)

  const seen = new Set<string>()
  const merged: Array<{
    id: string
    subject: string
    lastMessageAt: Date | null
    messageCount: number
    latestMessageId: string | null
    role: 'primary' | 'secondary'
  }> = []
  for (const t of primary) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    merged.push({ ...t, role: 'primary' as const })
  }
  for (const t of secondary) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    merged.push({ ...t, role: 'secondary' as const })
  }
  merged.sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0
    const bt = b.lastMessageAt?.getTime() ?? 0
    return bt - at
  })
  const totalBeforeCap = merged.length
  const capped = merged.slice(0, cap)
  if (totalBeforeCap > cap) truncated.threads = true

  // Pull the latest message snippet for each capped thread.
  const messageIds = capped.map((t) => t.latestMessageId).filter((m): m is string => Boolean(m))
  const snippets = messageIds.length
    ? await db
        .select({ id: schema.Message.id, snippet: schema.Message.snippet })
        .from(schema.Message)
        .where(inArray(schema.Message.id, messageIds))
    : []
  const snippetById = new Map(snippets.map((s) => [s.id, s.snippet]))

  return capped.map((t) => ({
    id: t.id,
    subject: t.subject,
    lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
    messageCount: t.messageCount,
    lastMessageSnippet: t.latestMessageId
      ? ((snippetById.get(t.latestMessageId) ?? null)?.slice(0, SNIPPET_CHARS) ?? null)
      : null,
    role: t.role,
  }))
}

async function loadComments(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  cap: number,
  truncated: Record<string, boolean>
) {
  const rows = await db
    .select({
      id: schema.Comment.id,
      content: schema.Comment.content,
      createdAt: schema.Comment.createdAt,
      parentId: schema.Comment.parentId,
      createdById: schema.Comment.createdById,
    })
    .from(schema.Comment)
    .where(
      and(
        eq(schema.Comment.entityId, entityInstanceId),
        eq(schema.Comment.organizationId, organizationId),
        isNull(schema.Comment.deletedAt)
      )
    )
    .orderBy(desc(schema.Comment.createdAt))
    .limit(cap + 1)
  if (rows.length > cap) truncated.comments = true
  return rows.slice(0, cap).map((r) => ({
    id: r.id,
    content:
      r.content.length > COMMENT_CHARS ? `${r.content.slice(0, COMMENT_CHARS)}...` : r.content,
    by: null as string | null, // filled in by the caller after batch resolve
    byUserId: r.createdById,
    at: r.createdAt.toISOString(),
    parentId: r.parentId,
  }))
}

async function loadTimeline(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  cap: number,
  since: Date,
  truncated: Record<string, boolean>
) {
  const rows = await db
    .select({
      id: schema.TimelineEvent.id,
      eventType: schema.TimelineEvent.eventType,
      startedAt: schema.TimelineEvent.startedAt,
      actorId: schema.TimelineEvent.actorId,
      actorType: schema.TimelineEvent.actorType,
      eventData: schema.TimelineEvent.eventData,
    })
    .from(schema.TimelineEvent)
    .where(
      and(
        eq(schema.TimelineEvent.organizationId, organizationId),
        eq(schema.TimelineEvent.entityId, entityInstanceId),
        gte(schema.TimelineEvent.startedAt, since)
      )
    )
    .orderBy(desc(schema.TimelineEvent.startedAt))
    .limit(cap + 1)
  if (rows.length > cap) truncated.timeline = true
  return rows.slice(0, cap).map((r) => {
    const payloadString = r.eventData ? JSON.stringify(r.eventData) : ''
    return {
      type: r.eventType,
      at: r.startedAt.toISOString(),
      by: null as string | null,
      byUserId: r.actorType === 'user' ? r.actorId : null,
      payloadSummary:
        payloadString.length > TIMELINE_PAYLOAD_CHARS
          ? `${payloadString.slice(0, TIMELINE_PAYLOAD_CHARS)}...`
          : payloadString,
    }
  })
}

async function loadOpenTasks(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  cap: number,
  truncated: Record<string, boolean>
) {
  const rows = await db
    .select({
      id: schema.Task.id,
      title: schema.Task.title,
      deadline: schema.Task.deadline,
    })
    .from(schema.Task)
    .innerJoin(schema.TaskReference, eq(schema.TaskReference.taskId, schema.Task.id))
    .where(
      and(
        eq(schema.Task.organizationId, organizationId),
        eq(schema.TaskReference.referencedEntityInstanceId, entityInstanceId),
        isNull(schema.TaskReference.deletedAt),
        isNull(schema.Task.completedAt),
        isNull(schema.Task.archivedAt)
      )
    )
    .orderBy(asc(schema.Task.deadline))
    .limit(cap + 1)
  if (rows.length > cap) truncated.tasks = true

  // Resolve assignees in one query.
  const taskIds = rows.slice(0, cap).map((r) => r.id)
  const assignees = taskIds.length
    ? await db
        .select({
          taskId: schema.TaskAssignment.taskId,
          assignedToUserId: schema.TaskAssignment.assignedToUserId,
          unassignedAt: schema.TaskAssignment.unassignedAt,
        })
        .from(schema.TaskAssignment)
        .where(inArray(schema.TaskAssignment.taskId, taskIds))
    : []
  const byTaskId = new Map<string, string[]>()
  for (const a of assignees) {
    if (a.unassignedAt) continue
    const arr = byTaskId.get(a.taskId) ?? []
    arr.push(a.assignedToUserId)
    byTaskId.set(a.taskId, arr)
  }

  return rows.slice(0, cap).map((r) => ({
    id: r.id,
    title: r.title,
    deadline: r.deadline ? r.deadline.toISOString() : null,
    assignees: byTaskId.get(r.id) ?? [],
  }))
}

async function loadFieldChanges(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  cap: number,
  since: Date,
  truncated: Record<string, boolean>
) {
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
        eq(schema.TimelineEvent.organizationId, organizationId),
        eq(schema.TimelineEvent.entityId, entityInstanceId),
        inArray(schema.TimelineEvent.eventType, FIELD_UPDATE_EVENT_TYPES),
        gte(schema.TimelineEvent.startedAt, since)
      )
    )
    .orderBy(desc(schema.TimelineEvent.startedAt))
    .limit(cap * 2)

  const out: Array<{
    fieldSystemAttribute: string
    oldDisplay: string | null
    newDisplay: string | null
    at: string
    by: string | null
    byUserId: string | null
  }> = []
  for (const e of events) {
    const changes = (e.changes ?? []) as Array<{
      field: string
      oldDisplay?: TimelineFieldChangeSnapshotValue
      newDisplay?: TimelineFieldChangeSnapshotValue
    }>
    for (const c of changes) {
      out.push({
        fieldSystemAttribute: c.field,
        oldDisplay: snapshotToDisplay(c.oldDisplay ?? null),
        newDisplay: snapshotToDisplay(c.newDisplay ?? null),
        at: e.startedAt.toISOString(),
        by: null,
        byUserId: e.actorType === 'user' ? e.actorId : null,
      })
      if (out.length >= cap) {
        truncated.field_changes = true
        return out
      }
    }
  }
  return out
}

async function loadRelatedViaThreads(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  threadIds: string[],
  cap: number,
  truncated: Record<string, boolean>
) {
  if (threadIds.length === 0) return []

  // Other entities (a) primary-linked to those threads, or (b) secondary-linked via ThreadEntityLink.
  const fromPrimary = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.Thread)
    .innerJoin(
      schema.EntityInstance,
      eq(schema.EntityInstance.id, schema.Thread.primaryEntityInstanceId)
    )
    .where(
      and(
        eq(schema.Thread.organizationId, organizationId),
        inArray(schema.Thread.id, threadIds),
        isNotNull(schema.Thread.primaryEntityInstanceId),
        ne(schema.EntityInstance.id, entityInstanceId)
      )
    )

  const fromSecondary = await db
    .select({
      id: schema.EntityInstance.id,
      entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.ThreadEntityLink)
    .innerJoin(
      schema.EntityInstance,
      eq(schema.EntityInstance.id, schema.ThreadEntityLink.entityInstanceId)
    )
    .where(
      and(
        eq(schema.ThreadEntityLink.organizationId, organizationId),
        inArray(schema.ThreadEntityLink.threadId, threadIds),
        isNull(schema.ThreadEntityLink.unlinkedAt),
        ne(schema.ThreadEntityLink.entityInstanceId, entityInstanceId)
      )
    )

  const seen = new Set<string>()
  const out: Array<{
    id: string
    entityDefinitionId: string
    primaryDisplay: string | null
    relationship: 'shares-thread'
  }> = []
  for (const e of [...fromPrimary, ...fromSecondary]) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push({
      id: e.id,
      entityDefinitionId: e.entityDefinitionId,
      primaryDisplay: e.displayName ?? null,
      relationship: 'shares-thread' as const,
    })
    if (out.length >= cap) break
  }
  if (seen.size > cap) truncated.related = true
  return out
}

async function loadMeetings(
  db: Db,
  organizationId: string,
  entityInstanceId: string,
  cap: number,
  since: Date,
  truncated: Record<string, boolean>
) {
  // Two paths: entity is itself a meeting, or entity is a contact/company that attended meetings.
  const participantMeetings = await db
    .select({ meetingId: schema.MeetingParticipant.meetingId })
    .from(schema.MeetingParticipant)
    .where(
      and(
        eq(schema.MeetingParticipant.organizationId, organizationId),
        or(
          eq(schema.MeetingParticipant.contactEntityInstanceId, entityInstanceId),
          eq(schema.MeetingParticipant.companyEntityInstanceId, entityInstanceId)
        )
      )
    )
  const meetingIds = Array.from(
    new Set([entityInstanceId, ...participantMeetings.map((m) => m.meetingId)])
  )

  const recordings = await db
    .select({
      id: schema.CallRecording.id,
      meetingId: schema.CallRecording.meetingId,
      startedAt: schema.CallRecording.startedAt,
      durationSeconds: schema.CallRecording.durationSeconds,
      transcriptId: schema.Transcript.id,
    })
    .from(schema.CallRecording)
    .leftJoin(schema.Transcript, eq(schema.Transcript.callRecordingId, schema.CallRecording.id))
    .where(
      and(
        eq(schema.CallRecording.organizationId, organizationId),
        inArray(schema.CallRecording.meetingId, meetingIds),
        isNotNull(schema.CallRecording.startedAt),
        gte(schema.CallRecording.startedAt, since)
      )
    )
    .orderBy(desc(schema.CallRecording.startedAt))
    .limit(cap + 1)
  if (recordings.length > cap) truncated.meetings = true
  const capped = recordings.slice(0, cap)

  const uniqueMeetingIds = Array.from(new Set(capped.map((r) => r.meetingId)))
  const [meetings, participantsAll] = uniqueMeetingIds.length
    ? await Promise.all([
        db
          .select({
            id: schema.EntityInstance.id,
            displayName: schema.EntityInstance.displayName,
          })
          .from(schema.EntityInstance)
          .where(
            and(
              eq(schema.EntityInstance.organizationId, organizationId),
              inArray(schema.EntityInstance.id, uniqueMeetingIds)
            )
          ),
        db
          .select({
            meetingId: schema.MeetingParticipant.meetingId,
            name: schema.MeetingParticipant.name,
          })
          .from(schema.MeetingParticipant)
          .where(
            and(
              eq(schema.MeetingParticipant.organizationId, organizationId),
              inArray(schema.MeetingParticipant.meetingId, uniqueMeetingIds)
            )
          ),
      ])
    : [[], []]

  const titleByMeetingId = new Map(meetings.map((m) => [m.id, m.displayName]))
  const participantsByMeetingId = new Map<string, string[]>()
  for (const p of participantsAll) {
    const arr = participantsByMeetingId.get(p.meetingId) ?? []
    arr.push(p.name)
    participantsByMeetingId.set(p.meetingId, arr)
  }

  return capped.map((r) => ({
    id: r.meetingId,
    callRecordingId: r.id,
    title: titleByMeetingId.get(r.meetingId) ?? null,
    at: r.startedAt ? r.startedAt.toISOString() : null,
    durationMin:
      r.durationSeconds !== null && r.durationSeconds !== undefined
        ? Math.round(r.durationSeconds / 60)
        : null,
    participantNames: participantsByMeetingId.get(r.meetingId) ?? [],
    transcriptAvailable: r.transcriptId !== null,
    transcriptId: r.transcriptId,
  }))
}
