// packages/lib/src/recording/transcription/transcription-service.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { eq, inArray } from 'drizzle-orm'
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

  const transcriptId = generateId()

  // Build derived fields up front so we can do the full write inside a single transaction.
  const speakerMap = new Map<string, string>() // externalSpeakerId → our speakerId
  const speakerRows: (typeof schema.TranscriptSpeaker.$inferInsert)[] = []
  const seenSpeakers = new Set<string>()
  let speakerIndex = 0

  for (const utterance of transcriptData.utterances) {
    if (seenSpeakers.has(utterance.speakerId)) continue
    seenSpeakers.add(utterance.speakerId)
    speakerIndex += 1
    const speakerId = generateId()
    speakerMap.set(utterance.speakerId, speakerId)
    speakerRows.push({
      id: speakerId,
      organizationId,
      transcriptId,
      callRecordingId: recordingId,
      name: utterance.speakerName || `Speaker ${speakerIndex}`,
    })
  }

  const utteranceRows = transcriptData.utterances.map((u, idx) => ({
    id: generateId(),
    organizationId,
    transcriptId,
    speakerId: speakerMap.get(u.speakerId)!,
    startMs: u.startMs,
    endMs: u.endMs,
    text: u.text,
    words: u.words ?? null,
    sortOrder: idx,
  }))

  const speakerNames = new Map<string, string>()
  let nameIndex = 0
  for (const utterance of transcriptData.utterances) {
    if (!speakerNames.has(utterance.speakerId)) {
      nameIndex += 1
      speakerNames.set(utterance.speakerId, utterance.speakerName || `Speaker ${nameIndex}`)
    }
  }
  const fullText = transcriptData.utterances
    .map((u) => `${speakerNames.get(u.speakerId)}: ${u.text}`)
    .join('\n')

  const wordCount = transcriptData.utterances.reduce(
    (sum, u) => sum + u.text.split(/\s+/).filter(Boolean).length,
    0
  )

  try {
    await db.transaction(async (tx) => {
      // Idempotent: remove any existing transcript + children for this recording.
      const existing = await tx
        .select({ id: schema.Transcript.id })
        .from(schema.Transcript)
        .where(eq(schema.Transcript.callRecordingId, recordingId))

      if (existing.length > 0) {
        const existingIds = existing.map((e) => e.id)
        await tx
          .delete(schema.TranscriptUtterance)
          .where(inArray(schema.TranscriptUtterance.transcriptId, existingIds))
        await tx
          .delete(schema.TranscriptSpeaker)
          .where(inArray(schema.TranscriptSpeaker.transcriptId, existingIds))
        await tx.delete(schema.Transcript).where(inArray(schema.Transcript.id, existingIds))
      }

      await tx.insert(schema.Transcript).values({
        id: transcriptId,
        organizationId,
        callRecordingId: recordingId,
        transcriptionProvider: 'recall',
        type: 'async',
        status: 'completed',
        language: transcriptData.language ?? null,
        fullText,
        wordCount,
        updatedAt: new Date(),
      })

      if (speakerRows.length > 0) {
        await tx.insert(schema.TranscriptSpeaker).values(speakerRows)
      }

      if (utteranceRows.length > 0) {
        const batchSize = 500
        for (let i = 0; i < utteranceRows.length; i += batchSize) {
          const batch = utteranceRows.slice(i, i + batchSize)
          await tx.insert(schema.TranscriptUtterance).values(batch)
        }
      }
    })
  } catch (error) {
    // If the transaction rolled back, no partial rows to clean up. Still record a failed
    // placeholder row so the UI can show the error state.
    await db
      .insert(schema.Transcript)
      .values({
        id: generateId(),
        organizationId,
        callRecordingId: recordingId,
        transcriptionProvider: 'recall',
        type: 'async',
        status: 'failed',
        language: transcriptData.language ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoNothing()

    return err(error instanceof Error ? error : new Error(String(error)))
  }

  // Speaker matching runs outside the transaction (best-effort, slower lookups).
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
}
