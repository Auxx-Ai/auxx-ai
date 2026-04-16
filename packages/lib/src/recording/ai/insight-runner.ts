// packages/lib/src/recording/ai/insight-runner.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import {
  buildInsightJsonSchema,
  buildInsightResponseSchema,
  buildInsightSystemPrompt,
  buildInsightUserPrompt,
  slugifyKey,
} from './prompts/insight-prompt'
import { resolveRecordingLLM } from './resolve-llm'
import type { InsightSectionResult, InsightTemplateSection } from './types'

const logger = createScopedLogger('recording:ai:insights')

export interface RunInsightTemplateParams {
  db: Database
  organizationId: string
  callRecordingId: string
  templateId: string
  userId?: string
  /** Existing insight row id to reuse (optimistic UI). If omitted, a new row is created. */
  insightId?: string
}

export interface RunInsightTemplateResult {
  insightId: string
  templateId: string
}

export async function runInsightTemplate(
  params: RunInsightTemplateParams
): Promise<Result<RunInsightTemplateResult, Error>> {
  const { db, organizationId, callRecordingId, templateId, userId } = params

  // If the router pre-created a 'processing' row, any early return below must
  // mark it failed — otherwise the UI polls forever.
  const markFailedIfPreCreated = async () => {
    if (!params.insightId) return
    await db
      .update(schema.RecordingInsight)
      .set({ status: 'failed' })
      .where(eq(schema.RecordingInsight.id, params.insightId))
  }

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
    await markFailedIfPreCreated()
    return err(new NotFoundError('Recording not found'))
  }

  const [template] = await db
    .select()
    .from(schema.InsightTemplate)
    .where(
      and(
        eq(schema.InsightTemplate.id, templateId),
        eq(schema.InsightTemplate.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!template) {
    await markFailedIfPreCreated()
    return err(new NotFoundError('Insight template not found'))
  }

  const sections = normalizeTemplateSections(template.sections)
  if (sections.length === 0) {
    await markFailedIfPreCreated()
    return err(new Error('Insight template has no sections'))
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
    await markFailedIfPreCreated()
    return err(new Error('Transcript not available for insights generation'))
  }

  // Upsert the insight row in 'processing' state.
  const insightId = params.insightId ?? generateId()
  await db
    .insert(schema.RecordingInsight)
    .values({
      id: insightId,
      organizationId,
      callRecordingId,
      insightTemplateId: templateId,
      status: 'processing',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.RecordingInsight.id,
      set: { status: 'processing', updatedAt: new Date() },
    })

  const templateLike = {
    title: template.title,
    aiTitle: template.aiTitle,
    sections,
  }

  try {
    const { orchestrator, provider, model } = await resolveRecordingLLM(db, organizationId)

    const response = await orchestrator.invoke({
      provider,
      model,
      organizationId,
      userId: userId ?? recording.createdById,
      messages: [
        { role: 'system', content: buildInsightSystemPrompt(templateLike) },
        { role: 'user', content: buildInsightUserPrompt(transcript.fullText) },
      ],
      parameters: { temperature: 0.2, max_tokens: 2000 },
      structuredOutput: {
        enabled: true,
        schema: buildInsightJsonSchema(templateLike),
      },
      context: {
        source: 'other',
        recordingId: callRecordingId,
        kind: 'recording-insight',
        templateId,
      },
    })

    const raw: unknown = response.structured_output ?? safeParseJson(response.content)
    const zodSchema = buildInsightResponseSchema(templateLike)
    const parsed = zodSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error('Insight response did not match expected schema')
    }

    const resultSections: InsightSectionResult[] = sections
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((section) => {
        const key = slugifyKey(section.title)
        const value = (parsed.data as Record<string, unknown>)[key]
        const values =
          section.type === 'list'
            ? Array.isArray(value)
              ? value.filter((v): v is string => typeof v === 'string')
              : []
            : typeof value === 'string'
              ? [value]
              : []
        return {
          templateSectionId: section.id ?? slugifyKey(section.title),
          title: section.title,
          type: section.type,
          values,
        }
      })

    await db
      .update(schema.RecordingInsight)
      .set({
        status: 'completed',
        sections: resultSections,
      })
      .where(eq(schema.RecordingInsight.id, insightId))

    logger.info('Insight generated', {
      callRecordingId,
      templateId,
      insightId,
    })

    return ok({ insightId, templateId })
  } catch (error) {
    await db
      .update(schema.RecordingInsight)
      .set({ status: 'failed' })
      .where(eq(schema.RecordingInsight.id, insightId))

    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

export interface RunDefaultInsightsParams {
  db: Database
  organizationId: string
  callRecordingId: string
  userId?: string
}

export async function runDefaultInsights(
  params: RunDefaultInsightsParams
): Promise<Result<{ insightIds: string[] }, Error>> {
  const { db, organizationId, callRecordingId, userId } = params

  const templates = await db
    .select({ id: schema.InsightTemplate.id })
    .from(schema.InsightTemplate)
    .where(
      and(
        eq(schema.InsightTemplate.organizationId, organizationId),
        eq(schema.InsightTemplate.status, 'enabled'),
        eq(schema.InsightTemplate.isDefault, true)
      )
    )

  if (templates.length === 0) {
    return ok({ insightIds: [] })
  }

  // Idempotent: remove any prior insight rows for this recording before re-running defaults.
  await db
    .delete(schema.RecordingInsight)
    .where(eq(schema.RecordingInsight.callRecordingId, callRecordingId))

  const results = await Promise.allSettled(
    templates.map((t) =>
      runInsightTemplate({
        db,
        organizationId,
        callRecordingId,
        templateId: t.id,
        userId,
      })
    )
  )

  const insightIds: string[] = []
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.isOk()) {
      insightIds.push(result.value.value.insightId)
    }
  }

  return ok({ insightIds })
}

function normalizeTemplateSections(raw: unknown): InsightTemplateSection[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (s): s is InsightTemplateSection =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as InsightTemplateSection).title === 'string' &&
        typeof (s as InsightTemplateSection).prompt === 'string' &&
        ((s as InsightTemplateSection).type === 'list' ||
          (s as InsightTemplateSection).type === 'plaintext')
    )
    .map((s, idx) => ({
      id: s.id,
      title: s.title,
      prompt: s.prompt,
      type: s.type,
      sortOrder: typeof s.sortOrder === 'number' ? s.sortOrder : idx,
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
