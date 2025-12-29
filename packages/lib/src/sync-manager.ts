import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { SYNC_STATUS } from './shopify/shopify-types'

export class SyncManager {
  static async find(syncId: string) {
    const [result] = await db
      .select()
      .from(schema.SyncJob)
      .where(eq(schema.SyncJob.id, syncId))
      .limit(1)
    return result
  }

  static async my(organizationId: string | undefined) {
    if (!organizationId) return []
    return await db
      .select()
      .from(schema.SyncJob)
      .where(eq(schema.SyncJob.organizationId, organizationId))
  }

  static async create({
    organizationId,
    type,
    integrationId,
  }: {
    organizationId: string
    type: string
    integrationId: string
  }) {
    const [result] = await db
      .insert(schema.SyncJob)
      .values({
        type,
        status: SYNC_STATUS.PENDING,
        organizationId,
        integrationId,
        updatedAt: new Date(),
      })
      .returning({ id: schema.SyncJob.id })
    return result
  }

  static async start(syncId: string) {
    const [result] = await db
      .update(schema.SyncJob)
      .set({ status: SYNC_STATUS.IN_PROGRESS, updatedAt: new Date() })
      .where(eq(schema.SyncJob.id, syncId))
      .returning({ id: schema.SyncJob.id })
    return result
  }

  static async complete(syncId: string, totalRecords: number) {
    const [result] = await db
      .update(schema.SyncJob)
      .set({
        status: SYNC_STATUS.COMPLETED,
        totalRecords,
        endTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.SyncJob.id, syncId))
      .returning({ id: schema.SyncJob.id })
    return result
  }

  static async fail(syncId: string, errorMessage: string) {
    const [result] = await db
      .update(schema.SyncJob)
      .set({
        status: SYNC_STATUS.FAILED,
        error: errorMessage,
        endTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.SyncJob.id, syncId))
      .returning({ id: schema.SyncJob.id })
    return result
  }
}
