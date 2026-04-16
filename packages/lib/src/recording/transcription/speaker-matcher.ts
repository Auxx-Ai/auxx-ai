// packages/lib/src/recording/transcription/speaker-matcher.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { findRecording } from '../recording-queries'

const logger = createScopedLogger('recording:speaker-matcher')

interface MatchSpeakersParams {
  organizationId: string
  transcriptId: string
  callRecordingId: string
}

/** Normalize a name for comparison: lowercase, trim, collapse whitespace. */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Match TranscriptSpeaker records to MeetingParticipant records
 * using name-based fuzzy matching. Best-effort — unmatched speakers
 * can be manually assigned via `manualParticipantId`.
 */
export async function matchSpeakersToParticipants(params: MatchSpeakersParams): Promise<void> {
  const { organizationId, transcriptId, callRecordingId } = params

  // 1. Get speakers for this transcript
  const speakers = await db
    .select()
    .from(schema.TranscriptSpeaker)
    .where(eq(schema.TranscriptSpeaker.transcriptId, transcriptId))

  if (speakers.length === 0) return

  // 2. Get the recording to find the meetingId
  const recording = await findRecording({ id: callRecordingId, organizationId })
  if (!recording?.meetingId) {
    logger.info('No meeting linked to recording, skipping speaker matching', { callRecordingId })
    return
  }

  // 3. Get meeting participants (exclude bots)
  const participants = await db
    .select()
    .from(schema.MeetingParticipant)
    .where(
      and(
        eq(schema.MeetingParticipant.meetingId, recording.meetingId),
        eq(schema.MeetingParticipant.isBot, false)
      )
    )

  if (participants.length === 0) return

  // 4. Match speakers to participants
  for (const speaker of speakers) {
    const normalizedSpeaker = normalizeName(speaker.name)
    let matchedParticipantId: string | null = null
    let matchedIsOrganizer = false

    for (const participant of participants) {
      const normalizedParticipant = normalizeName(participant.name)

      // Exact match
      if (normalizedSpeaker === normalizedParticipant) {
        matchedParticipantId = participant.id
        matchedIsOrganizer = participant.isOrganizer
        break
      }

      // First-name match
      const speakerFirst = normalizedSpeaker.split(' ')[0]
      const participantFirst = normalizedParticipant.split(' ')[0]
      if (speakerFirst && participantFirst && speakerFirst === participantFirst) {
        matchedParticipantId = participant.id
        matchedIsOrganizer = participant.isOrganizer
        // Don't break — keep looking for an exact match
      }

      // Contains match (one name contains the other)
      if (
        !matchedParticipantId &&
        (normalizedSpeaker.includes(normalizedParticipant) ||
          normalizedParticipant.includes(normalizedSpeaker))
      ) {
        matchedParticipantId = participant.id
        matchedIsOrganizer = participant.isOrganizer
      }
    }

    if (matchedParticipantId) {
      await db
        .update(schema.TranscriptSpeaker)
        .set({
          participantId: matchedParticipantId,
          isHost: matchedIsOrganizer || null,
        })
        .where(eq(schema.TranscriptSpeaker.id, speaker.id))

      logger.info('Matched speaker to participant', {
        speakerId: speaker.id,
        speakerName: speaker.name,
        participantId: matchedParticipantId,
      })
    }
  }
}
