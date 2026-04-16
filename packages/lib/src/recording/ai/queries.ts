// packages/lib/src/recording/ai/queries.ts

import {
  type Database,
  type InsightTemplateEntity,
  type RecordingChapterEntity,
  type RecordingInsightEntity,
  schema,
} from '@auxx/database'
import { generateId } from '@auxx/utils'
import { and, asc, desc, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import type { InsightTemplateSection } from './types'

export async function listChapters(params: {
  db: Database
  organizationId: string
  callRecordingId: string
}): Promise<RecordingChapterEntity[]> {
  const { db, organizationId, callRecordingId } = params
  return db
    .select()
    .from(schema.RecordingChapter)
    .where(
      and(
        eq(schema.RecordingChapter.callRecordingId, callRecordingId),
        eq(schema.RecordingChapter.organizationId, organizationId)
      )
    )
    .orderBy(asc(schema.RecordingChapter.sortOrder))
}

export async function listInsights(params: {
  db: Database
  organizationId: string
  callRecordingId: string
}): Promise<RecordingInsightEntity[]> {
  const { db, organizationId, callRecordingId } = params
  return db
    .select()
    .from(schema.RecordingInsight)
    .where(
      and(
        eq(schema.RecordingInsight.callRecordingId, callRecordingId),
        eq(schema.RecordingInsight.organizationId, organizationId)
      )
    )
    .orderBy(desc(schema.RecordingInsight.updatedAt))
}

export async function getInsightDetail(params: {
  db: Database
  organizationId: string
  insightId: string
}): Promise<Result<RecordingInsightEntity, Error>> {
  const { db, organizationId, insightId } = params
  const [row] = await db
    .select()
    .from(schema.RecordingInsight)
    .where(
      and(
        eq(schema.RecordingInsight.id, insightId),
        eq(schema.RecordingInsight.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!row) return err(new NotFoundError('Insight not found'))
  return ok(row)
}

export async function listInsightTemplates(params: {
  db: Database
  organizationId: string
  status?: 'enabled' | 'disabled' | 'archived'
}): Promise<InsightTemplateEntity[]> {
  const { db, organizationId, status } = params
  const conditions = [eq(schema.InsightTemplate.organizationId, organizationId)]
  if (status) {
    conditions.push(eq(schema.InsightTemplate.status, status))
  }
  return db
    .select()
    .from(schema.InsightTemplate)
    .where(and(...conditions))
    .orderBy(asc(schema.InsightTemplate.sortOrder))
}

export interface CreateInsightTemplateInput {
  db: Database
  organizationId: string
  userId: string
  title: string
  aiTitle?: string
  isDefault?: boolean
  sortOrder?: string
  sections: Array<Omit<InsightTemplateSection, 'id' | 'sortOrder'> & { sortOrder?: number }>
}

export async function createInsightTemplate(
  params: CreateInsightTemplateInput
): Promise<InsightTemplateEntity> {
  const { db, organizationId, userId, title, aiTitle, isDefault, sortOrder, sections } = params

  const sectionsWithIds: InsightTemplateSection[] = sections.map((s, idx) => ({
    id: generateId(),
    title: s.title,
    prompt: s.prompt,
    type: s.type,
    sortOrder: s.sortOrder ?? idx,
  }))

  const id = generateId()
  const [inserted] = await db
    .insert(schema.InsightTemplate)
    .values({
      id,
      organizationId,
      title,
      aiTitle: aiTitle ?? null,
      isDefault: isDefault ?? false,
      sortOrder: sortOrder ?? new Date().toISOString(),
      sections: sectionsWithIds,
      createdById: userId,
      updatedAt: new Date(),
    })
    .returning()

  return inserted!
}
