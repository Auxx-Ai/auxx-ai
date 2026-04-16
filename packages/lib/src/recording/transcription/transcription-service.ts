// packages/lib/src/recording/transcription/transcription-service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { getProvider } from '../bot/providers'
import type { BotProviderId } from '../bot/types'
import { findRecording } from '../recording-queries'
import { matchSpeakersToParticipants } from './speaker-matcher'

const logger = createScopedLogger('recording:transcription')

export type TranscriptionProvider =
  | 'recall'
  | 'deepgram'
  | 'whisper'
  | 'assemblyai'
  | 'gladia'
  | 'meeting_captions'

interface ProcessTranscriptParams {
  organizationId: string
  recordingId: string
}

interface ProcessTranscriptResult {
  transcriptId: string
}

/**
 * Fetch transcript from the bot provider, store it in the database,
 * and attempt speaker-to-participant matching.
 */
export async function processTranscript(
  params: ProcessTranscriptParams
): Promise<Result<ProcessTranscriptResult, Error>> {
  const { organizationId, recordingId } = params

  // 1. Look up CallRecording
  const recording = await findRecording({ id: recordingId, organizationId })
  if (!recording) {
    return err(new NotFoundError('Recording not found'))
  }

  if (!recording.externalBotId) {
    return err(new Error('Recording has no external bot ID'))
  }

  // 2. Resolve bot provider
  const provider = getProvider(recording.provider as BotProviderId)

  // 3. Fetch transcript from provider
  const transcriptResult = await provider.getTranscript(recording.externalBotId)
  if (transcriptResult.isErr()) {
    return err(transcriptResult.error)
  }

  const transcriptData = transcriptResult.value
  if (!transcriptData || transcriptData.utterances.length === 0) {
    return err(new Error('Transcript not available or empty'))
  }

  // 4. Insert Transcript row
  const transcriptId = generateId()
  await db.insert(schema.Transcript).values({
    id: transcriptId,
    organizationId,
    callRecordingId: recordingId,
    transcriptionProvider: 'recall',
    type: 'async',
    status: 'processing',
    language: transcriptData.language ?? null,
    updatedAt: new Date(),
  })

  try {
    // 5. Build speaker map and insert TranscriptSpeaker rows
    const speakerMap = new Map<string, string>() // externalSpeakerId → our speakerId
    const seenSpeakers = new Set<string>()

    for (const utterance of transcriptData.utterances) {
      if (!seenSpeakers.has(utterance.speakerId)) {
        seenSpeakers.add(utterance.speakerId)
        const speakerId = generateId()
        speakerMap.set(utterance.speakerId, speakerId)

        await db.insert(schema.TranscriptSpeaker).values({
          id: speakerId,
          organizationId,
          transcriptId,
          callRecordingId: recordingId,
          name: utterance.speakerName || `Speaker ${seenSpeakers.size}`,
        })
      }
    }

    // 6. Insert TranscriptUtterance rows in bulk
    const utteranceRows = transcriptData.utterances.map((u, idx) => ({
      id: generateId(),
      organizationId,
      transcriptId,
      speakerId: speakerMap.get(u.speakerId)!,
      startMs: u.startMs,
      endMs: u.endMs,
      text: u.text,
      sortOrder: idx,
    }))

    if (utteranceRows.length > 0) {
      // Insert in batches of 500 to avoid query size limits
      const batchSize = 500
      for (let i = 0; i < utteranceRows.length; i += batchSize) {
        const batch = utteranceRows.slice(i, i + batchSize)
        await db.insert(schema.TranscriptUtterance).values(batch)
      }
    }

    // 7. Build fullText (speaker-attributed)
    const speakerNames = new Map<string, string>()
    for (const utterance of transcriptData.utterances) {
      if (!speakerNames.has(utterance.speakerId)) {
        speakerNames.set(
          utterance.speakerId,
          utterance.speakerName || `Speaker ${speakerNames.size + 1}`
        )
      }
    }

    const fullText = transcriptData.utterances
      .map((u) => `${speakerNames.get(u.speakerId)}: ${u.text}`)
      .join('\n')

    const wordCount = transcriptData.utterances.reduce(
      (sum, u) => sum + u.text.split(/\s+/).filter(Boolean).length,
      0
    )

    // 8. Update Transcript to completed
    await db
      .update(schema.Transcript)
      .set({
        status: 'completed',
        fullText,
        wordCount,
        language: transcriptData.language ?? null,
      })
      .where(eq(schema.Transcript.id, transcriptId))

    // 9. Speaker matching (best-effort)
    try {
      await matchSpeakersToParticipants({
        organizationId,
        transcriptId,
        callRecordingId: recordingId,
      })
    } catch (matchError) {
      logger.warn('Speaker matching failed (non-fatal)', {
        transcriptId,
        error: matchError instanceof Error ? matchError.message : String(matchError),
      })
    }

    return ok({ transcriptId })
  } catch (error) {
    // Mark transcript as failed
    await db
      .update(schema.Transcript)
      .set({ status: 'failed' })
      .where(eq(schema.Transcript.id, transcriptId))

    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
