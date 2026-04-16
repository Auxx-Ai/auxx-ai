// packages/lib/src/recording/transcription/transcript-queries.ts

import { database as db, schema, type TranscriptSpeakerEntity } from '@auxx/database'
import { and, asc, eq, gt } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// getTranscript
// ---------------------------------------------------------------------------

/** Get transcript with speakers for a recording. Returns null if no transcript exists. */
export async function getTranscript(recordingId: string, organizationId: string) {
  const [transcript] = await db
    .select()
    .from(schema.Transcript)
    .where(
      and(
        eq(schema.Transcript.callRecordingId, recordingId),
        eq(schema.Transcript.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!transcript) return null

  const speakers = await db
    .select()
    .from(schema.TranscriptSpeaker)
    .where(eq(schema.TranscriptSpeaker.transcriptId, transcript.id))

  return { ...transcript, speakers }
}

// ---------------------------------------------------------------------------
// getUtterances
// ---------------------------------------------------------------------------

interface GetUtterancesParams {
  transcriptId: string
  organizationId: string
  cursor?: number
  limit: number
}

/** Get paginated utterances for a transcript with speaker info. */
export async function getUtterances(params: GetUtterancesParams) {
  const { transcriptId, organizationId, cursor, limit } = params

  const conditions = [
    eq(schema.TranscriptUtterance.transcriptId, transcriptId),
    eq(schema.TranscriptUtterance.organizationId, organizationId),
  ]

  if (cursor !== undefined) {
    conditions.push(gt(schema.TranscriptUtterance.sortOrder, cursor))
  }

  const utterances = await db
    .select()
    .from(schema.TranscriptUtterance)
    .where(and(...conditions))
    .orderBy(asc(schema.TranscriptUtterance.sortOrder))
    .limit(limit + 1)

  const hasMore = utterances.length > limit
  const items = hasMore ? utterances.slice(0, limit) : utterances
  const nextCursor = hasMore ? items[items.length - 1]?.sortOrder : undefined

  // Get speakers for these utterances
  const speakerIds = [...new Set(items.map((u) => u.speakerId))]
  let speakerMap: Record<string, TranscriptSpeakerEntity> = {}

  if (speakerIds.length > 0) {
    const speakers = await db
      .select()
      .from(schema.TranscriptSpeaker)
      .where(eq(schema.TranscriptSpeaker.transcriptId, transcriptId))

    speakerMap = Object.fromEntries(speakers.map((s) => [s.id, s]))
  }

  return {
    items: items.map((u) => ({
      ...u,
      speaker: speakerMap[u.speakerId] ?? null,
    })),
    nextCursor,
  }
}

// ---------------------------------------------------------------------------
// updateSpeakerParticipant
// ---------------------------------------------------------------------------

/** Manually assign a speaker to a participant. Returns updated row or undefined. */
export async function updateSpeakerParticipant(
  speakerId: string,
  participantId: string,
  organizationId: string
): Promise<TranscriptSpeakerEntity | undefined> {
  const [updated] = await db
    .update(schema.TranscriptSpeaker)
    .set({ manualParticipantId: participantId })
    .where(
      and(
        eq(schema.TranscriptSpeaker.id, speakerId),
        eq(schema.TranscriptSpeaker.organizationId, organizationId)
      )
    )
    .returning()

  return updated
}
