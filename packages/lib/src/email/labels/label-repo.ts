// lib/email/repositories/label-repository.ts
import { database as db, schema } from '@auxx/database'
import type { LabelType } from '@auxx/database/types'
import { and, asc, eq } from 'drizzle-orm'
export class LabelRepo {
  // Find labels by various criteria
  async findByProviderLabelId(
    organizationId: string,
    integrationType: string,
    integrationId: string,
    labelId: string
  ) {
    const [row] = await db
      .select()
      .from(schema.Label)
      .where(
        and(
          eq(schema.Label.organizationId, organizationId),
          eq(schema.Label.integrationType, integrationType),
          eq(schema.Label.integrationId, integrationId),
          eq(schema.Label.labelId, labelId)
        )
      )
      .limit(1)
    return row || null
  }
  async findAll(organizationId: string, integrationType?: string, integrationId?: string) {
    const conditions = [eq(schema.Label.organizationId, organizationId)] as any[]
    if (integrationType) conditions.push(eq(schema.Label.integrationType, integrationType))
    if (integrationId) conditions.push(eq(schema.Label.integrationId, integrationId))
    return await db
      .select()
      .from(schema.Label)
      .where(and(...conditions))
      .orderBy(asc(schema.Label.name))
  }
  // CRUD operations
  async create(
    organizationId: string,
    integrationType: string,
    integrationId: string,
    userId: string,
    labelData: {
      labelId: string
      name: string
      type: LabelType
      backgroundColor?: string
      textColor?: string
      description?: string
      isVisible?: boolean
    }
  ) {
    const [row] = await db
      .insert(schema.Label)
      .values({
        organizationId,
        integrationType,
        integrationId,
        // userId not stored on Label schema
        labelId: labelData.labelId,
        name: labelData.name,
        type: labelData.type as any,
        backgroundColor: labelData.backgroundColor,
        textColor: labelData.textColor,
        description: labelData.description,
        isVisible: labelData.isVisible ?? true,
        updatedAt: new Date(),
      })
      .returning()
    return row
  }
  async update(
    id: string,
    data: Partial<{
      name: string
      description: string
      backgroundColor: string
      textColor: string
      isVisible: boolean
      enabled: boolean
    }>
  ) {
    const [row] = await db
      .update(schema.Label)
      .set(data as any)
      .where(eq(schema.Label.id, id))
      .returning()
    return row
  }
  async delete(id: string) {
    await db.delete(schema.Label).where(eq(schema.Label.id, id))
    return true
  }
  // Thread label operations
  async addLabelToThread(labelId: string, threadId: string) {
    try {
      await db.insert(schema.LabelsOnThread).values({ labelId, threadId })
      return true
    } catch (error) {
      // Handle unique constraint violations (label already on thread)
      return false
    }
  }
  async removeLabelFromThread(labelId: string, threadId: string) {
    try {
      await db
        .delete(schema.LabelsOnThread)
        .where(
          and(
            eq(schema.LabelsOnThread.threadId, threadId),
            eq(schema.LabelsOnThread.labelId, labelId)
          )
        )
      return true
    } catch (error) {
      // Handle not found errors
      return false
    }
  }
  async getThreadLabels(threadId: string) {
    return await db
      .select({
        id: schema.Label.id,
        createdAt: schema.Label.createdAt,
        updatedAt: schema.Label.updatedAt,
        integrationType: schema.Label.integrationType,
        integrationId: schema.Label.integrationId,
        labelId: schema.Label.labelId,
        name: schema.Label.name,
        description: schema.Label.description,
        enabled: schema.Label.enabled,
        isVisible: schema.Label.isVisible,
        backgroundColor: schema.Label.backgroundColor,
        textColor: schema.Label.textColor,
        type: schema.Label.type,
        organizationId: schema.Label.organizationId,
      })
      .from(schema.Label)
      .innerJoin(
        schema.LabelsOnThread,
        and(
          eq(schema.LabelsOnThread.labelId, schema.Label.id),
          eq(schema.LabelsOnThread.threadId, threadId)
        )
      )
  }
}
