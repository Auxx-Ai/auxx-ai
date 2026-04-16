// packages/lib/src/recording/ai/chapter-generator.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, asc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import {
  buildChapterSystemPrompt,
  buildChapterUserPrompt,
  CHAPTER_JSON_SCHEMA,
  ChapterResponseSchema,
} from './prompts/chapter-prompt'
import { resolveRecordingLLM } from './resolve-llm'
import type { GeneratedChapter } from './types'

const logger = createScopedLogger('recording:ai:chapters')

const MIN_UTTERANCES_FOR_LLM_CHAPTERS = 30

export interface GenerateChaptersParams {
  db: Database
  organizationId: string
  callRecordingId: string
  userId?: string
}

export interface GenerateChaptersResult {
  chapterIds: string[]
}

export async function generateChapters(
  params: GenerateChaptersParams
): Promise<Result<GenerateChaptersResult, Error>> {
  const { db, organizationId, callRecordingId, userId } = params

  const [recording] = await db
    .select()
    .from(schema.CallRecording)
    .where(
      and(
        eq(schema.CallRecording.id, callRecordingId),
        eq(schema.CallRecording.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!recording) {
    return err(new NotFoundError('Recording not found'))
  }

  const durationMs = (recording.durationSeconds ?? 0) * 1000

  const [transcript] = await db
    .select()
    .from(schema.Transcript)
    .where(
      and(
        eq(schema.Transcript.callRecordingId, callRecordingId),
        eq(schema.Transcript.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!transcript) {
    return err(new Error('Transcript not available for chapter generation'))
  }

  const utterances = await db
    .select({
      id: schema.TranscriptUtterance.id,
      startMs: schema.TranscriptUtterance.startMs,
      endMs: schema.TranscriptUtterance.endMs,
      text: schema.TranscriptUtterance.text,
      speakerId: schema.TranscriptUtterance.speakerId,
    })
    .from(schema.TranscriptUtterance)
    .where(eq(schema.TranscriptUtterance.transcriptId, transcript.id))
    .orderBy(asc(schema.TranscriptUtterance.startMs))

  if (utterances.length === 0) {
    return err(new Error('Transcript has no utterances for chapter generation'))
  }

  const effectiveDurationMs =
    durationMs > 0 ? durationMs : (utterances[utterances.length - 1]?.endMs ?? 0)

  let chapters: GeneratedChapter[] = []

  if (utterances.length < MIN_UTTERANCES_FOR_LLM_CHAPTERS) {
    chapters = [{ title: 'Overview', startMs: 0, endMs: effectiveDurationMs }]
  } else {
    const speakerRows = await db
      .select({
        id: schema.TranscriptSpeaker.id,
        name: schema.TranscriptSpeaker.name,
      })
      .from(schema.TranscriptSpeaker)
      .where(eq(schema.TranscriptSpeaker.transcriptId, transcript.id))
    const speakerName = new Map(speakerRows.map((s) => [s.id, s.name]))

    const timestamped = utterances
      .map((u) => {
        const ts = formatTimestamp(u.startMs)
        const name = speakerName.get(u.speakerId) ?? 'Speaker'
        return `[${ts}] ${name}: ${u.text}`
      })
      .join('\n')

    const { orchestrator, provider, model } = await resolveRecordingLLM(db, organizationId)

    try {
      const response = await orchestrator.invoke({
        provider,
        model,
        organizationId,
        userId: userId ?? recording.createdById,
        messages: [
          {
            role: 'system',
            content: buildChapterSystemPrompt({ durationMs: effectiveDurationMs }),
          },
          { role: 'user', content: buildChapterUserPrompt(timestamped) },
        ],
        parameters: { temperature: 0.2, max_tokens: 1500 },
        structuredOutput: { enabled: true, schema: CHAPTER_JSON_SCHEMA },
        context: { source: 'other', recordingId: callRecordingId, kind: 'recording-chapters' },
      })

      const raw: unknown = response.structured_output ?? safeParseJson(response.content)
      const parsed = ChapterResponseSchema.safeParse(raw)
      if (!parsed.success) {
        logger.warn('Chapter response did not match schema', {
          callRecordingId,
          issues: parsed.error.issues,
        })
        return err(new Error('Chapter response did not match expected schema'))
      }

      chapters = sanitizeChapters(parsed.data.chapters, effectiveDurationMs)
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  // Idempotent replace.
  const insertedIds: string[] = []
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.RecordingChapter)
      .where(eq(schema.RecordingChapter.callRecordingId, callRecordingId))

    if (chapters.length > 0) {
      const rows = chapters.map((c, idx) => ({
        id: generateId(),
        organizationId,
        callRecordingId,
        title: c.title,
        startMs: c.startMs,
        endMs: c.endMs,
        sortOrder: idx,
      }))
      insertedIds.push(...rows.map((r) => r.id))
      await tx.insert(schema.RecordingChapter).values(rows)
    }
  })

  logger.info('Chapters generated', {
    callRecordingId,
    chapterCount: insertedIds.length,
  })

  return ok({ chapterIds: insertedIds })
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
}

function sanitizeChapters(
  raw: { title: string; startMs: number; endMs: number }[],
  durationMs: number
): GeneratedChapter[] {
  if (raw.length === 0) return []

  // Sort by startMs, clip to duration bounds, ensure monotonic non-overlapping.
  const sorted = raw
    .map((c) => ({
      title: c.title.trim(),
      startMs: Math.max(0, Math.min(c.startMs, durationMs)),
      endMs: Math.max(0, Math.min(c.endMs, durationMs)),
    }))
    .filter((c) => c.title.length > 0 && c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs)

  const result: GeneratedChapter[] = []
  let prevEnd = 0
  for (const chapter of sorted) {
    const start = Math.max(chapter.startMs, prevEnd)
    if (chapter.endMs <= start) continue
    result.push({ title: chapter.title, startMs: start, endMs: chapter.endMs })
    prevEnd = chapter.endMs
  }

  if (result.length > 0) {
    result[0]!.startMs = 0
    result[result.length - 1]!.endMs = durationMs
  }

  return result
}

function safeParseJson(content: string | null | undefined): unknown {
  if (!content) return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}
