// packages/lib/src/recording/ai/summary-generator.ts

import { type ActionItem, type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import {
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  SUMMARY_JSON_SCHEMA,
  type SummaryResponse,
  SummaryResponseSchema,
} from './prompts/summary-prompt'
import { resolveRecordingLLM } from './resolve-llm'
import type { GeneratedSummary } from './types'

const logger = createScopedLogger('recording:ai:summary')

export interface GenerateSummaryParams {
  db: Database
  organizationId: string
  callRecordingId: string
  userId?: string
}

/**
 * Generate a Markdown summary + structured action items from the recording's
 * transcript. Writes the result back to the CallRecording row.
 */
export async function generateSummary(
  params: GenerateSummaryParams
): Promise<Result<GeneratedSummary, Error>> {
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

  if (!transcript || !transcript.fullText) {
    return err(new Error('Transcript not available for summary generation'))
  }

  const participants = await db
    .select({
      name: schema.MeetingParticipant.name,
      isOrganizer: schema.MeetingParticipant.isOrganizer,
    })
    .from(schema.MeetingParticipant)
    .where(
      and(
        eq(schema.MeetingParticipant.meetingId, recording.meetingId),
        eq(schema.MeetingParticipant.organizationId, organizationId)
      )
    )

  const { orchestrator, provider, model } = await resolveRecordingLLM(db, organizationId)

  const systemPrompt = buildSummarySystemPrompt({
    participants: participants.map((p) => ({ name: p.name, isHost: p.isOrganizer })),
  })

  try {
    const response = await orchestrator.invoke({
      provider,
      model,
      organizationId,
      userId: userId ?? recording.createdById,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildSummaryUserPrompt(transcript.fullText) },
      ],
      parameters: { temperature: 0.2, max_tokens: 2000 },
      structuredOutput: { enabled: true, schema: SUMMARY_JSON_SCHEMA },
      context: { source: 'other', recordingId: callRecordingId, kind: 'recording-summary' },
    })

    const raw: unknown = response.structured_output ?? safeParseJson(response.content)
    const parsed = SummaryResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn('Summary response did not match schema', {
        callRecordingId,
        issues: parsed.error.issues,
      })
      return err(new Error('Summary response did not match expected schema'))
    }

    const { summary, actionItems } = parsed.data
    const normalizedActionItems = normalizeActionItems(actionItems)

    await db
      .update(schema.CallRecording)
      .set({
        summaryText: summary,
        actionItems: normalizedActionItems,
      })
      .where(eq(schema.CallRecording.id, callRecordingId))

    logger.info('Summary generated', {
      callRecordingId,
      actionItemCount: normalizedActionItems.length,
    })

    return ok({ summaryText: summary, actionItems: normalizedActionItems })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

function normalizeActionItems(items: SummaryResponse['actionItems']): ActionItem[] {
  return items.map((item) => ({
    id: generateId(),
    title: item.title,
    description: item.description,
    owner: item.owner,
    dueDate: item.dueDate,
    priority: item.priority,
  }))
}

function safeParseJson(content: string | null | undefined): unknown {
  if (!content) return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}
