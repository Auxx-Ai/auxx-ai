// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-transcripts-for-entity.ts

import { schema } from '@auxx/database'
import { and, desc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListTranscriptsForEntityDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'

const MAX_LIMIT = 25
const SNIPPET_LENGTH = 100

export function createListTranscriptsForEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_transcripts_for_entity',
    idempotent: true,
    outputDigestSchema: ListTranscriptsForEntityDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { transcripts?: Array<{ transcriptId?: string }> }
      const transcripts = Array.isArray(out.transcripts) ? out.transcripts : []
      return {
        count: transcripts.length,
        ids: takeSample(
          transcripts.map((t) => String(t.transcriptId ?? '')).filter((s) => s.length > 0)
        ),
      }
    },
    description:
      'List meeting transcripts linked to an entity. Resolves via two paths: (1) the entity itself is a meeting (CallRecording.meetingId matches), or (2) the entity is a contact/company that attended meetings (MeetingParticipant.contactEntityInstanceId / companyEntityInstanceId). Returns metadata only — call `get_transcript` to fetch the text.',
    parameters: {
      type: 'object',
      properties: {
        entityInstanceId: {
          type: 'string',
          description: 'EntityInstance ID (meeting / contact / company / other).',
        },
        sinceDays: {
          type: 'number',
          description: 'Look back this many days (default 180).',
        },
        limit: {
          type: 'number',
          description: `Max transcripts (default 10, max ${MAX_LIMIT}).`,
        },
      },
      required: ['entityInstanceId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const entityInstanceId = args.entityInstanceId as string
      const sinceDays = (args.sinceDays as number | undefined) ?? 180
      const limit = Math.min((args.limit as number) ?? 10, MAX_LIMIT)
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

      // Path 1: the entity IS a meeting → CallRecording.meetingId match.
      // Path 2: the entity is a contact/company → meetings via MeetingParticipant.
      const participantMeetings = await db
        .select({ meetingId: schema.MeetingParticipant.meetingId })
        .from(schema.MeetingParticipant)
        .where(
          and(
            eq(schema.MeetingParticipant.organizationId, agentDeps.organizationId),
            or(
              eq(schema.MeetingParticipant.contactEntityInstanceId, entityInstanceId),
              eq(schema.MeetingParticipant.companyEntityInstanceId, entityInstanceId)
            )
          )
        )

      const meetingIds = Array.from(
        new Set([entityInstanceId, ...participantMeetings.map((m) => m.meetingId)])
      )

      // Find recordings (with attached transcripts) for these meetings.
      const recordings = await db
        .select({
          recordingId: schema.CallRecording.id,
          meetingId: schema.CallRecording.meetingId,
          startedAt: schema.CallRecording.startedAt,
          durationSeconds: schema.CallRecording.durationSeconds,
          transcriptId: schema.Transcript.id,
          fullText: schema.Transcript.fullText,
          wordCount: schema.Transcript.wordCount,
          status: schema.Transcript.status,
        })
        .from(schema.CallRecording)
        .innerJoin(
          schema.Transcript,
          eq(schema.Transcript.callRecordingId, schema.CallRecording.id)
        )
        .where(
          and(
            eq(schema.CallRecording.organizationId, agentDeps.organizationId),
            inArray(schema.CallRecording.meetingId, meetingIds),
            isNotNull(schema.CallRecording.startedAt),
            gte(schema.CallRecording.startedAt, since)
          )
        )
        .orderBy(desc(schema.CallRecording.startedAt))
        .limit(limit)

      if (recordings.length === 0) {
        return { success: true, output: { transcripts: [] } }
      }

      // Pull meeting display names + participant lists.
      const uniqueMeetingIds = Array.from(new Set(recordings.map((r) => r.meetingId)))
      const [meetings, participantsAll] = await Promise.all([
        db
          .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
          .from(schema.EntityInstance)
          .where(
            and(
              eq(schema.EntityInstance.organizationId, agentDeps.organizationId),
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
              eq(schema.MeetingParticipant.organizationId, agentDeps.organizationId),
              inArray(schema.MeetingParticipant.meetingId, uniqueMeetingIds)
            )
          ),
      ])

      const titleByMeetingId = new Map(meetings.map((m) => [m.id, m.displayName]))
      const participantsByMeetingId = new Map<string, string[]>()
      for (const p of participantsAll) {
        const arr = participantsByMeetingId.get(p.meetingId) ?? []
        arr.push(p.name)
        participantsByMeetingId.set(p.meetingId, arr)
      }

      // Speaker counts per transcript.
      const transcriptIds = recordings.map((r) => r.transcriptId)
      const speakerRows = await db
        .select({
          transcriptId: schema.TranscriptSpeaker.transcriptId,
          speakerId: schema.TranscriptSpeaker.id,
        })
        .from(schema.TranscriptSpeaker)
        .where(
          and(
            eq(schema.TranscriptSpeaker.organizationId, agentDeps.organizationId),
            inArray(schema.TranscriptSpeaker.transcriptId, transcriptIds)
          )
        )
      const speakerCountByTranscriptId = new Map<string, number>()
      for (const s of speakerRows) {
        speakerCountByTranscriptId.set(
          s.transcriptId,
          (speakerCountByTranscriptId.get(s.transcriptId) ?? 0) + 1
        )
      }

      const transcripts = recordings.map((r) => ({
        transcriptId: r.transcriptId,
        callRecordingId: r.recordingId,
        meetingId: r.meetingId,
        meetingTitle: titleByMeetingId.get(r.meetingId) ?? null,
        at: r.startedAt ? r.startedAt.toISOString() : null,
        durationMin:
          r.durationSeconds !== null && r.durationSeconds !== undefined
            ? Math.round(r.durationSeconds / 60)
            : null,
        participantNames: participantsByMeetingId.get(r.meetingId) ?? [],
        speakerCount: speakerCountByTranscriptId.get(r.transcriptId) ?? 0,
        wordCount: r.wordCount ?? 0,
        status: r.status,
        snippet: r.fullText ? r.fullText.slice(0, SNIPPET_LENGTH) : '',
      }))

      return { success: true, output: { transcripts } }
    },
  }
}
