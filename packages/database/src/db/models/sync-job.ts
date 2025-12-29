// packages/database/src/db/models/sync-job.ts
// SyncJob model built on BaseModel (org-scoped)

import { and, desc, type SQL } from 'drizzle-orm'
import { SyncJob } from '../schema/sync-job'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected SyncJob entity type */
export type SyncJobEntity = typeof SyncJob.$inferSelect
/** Insertable SyncJob input type */
export type CreateSyncJobInput = typeof SyncJob.$inferInsert
/** Updatable SyncJob input type */
export type UpdateSyncJobInput = Partial<CreateSyncJobInput>

/**
 * Narrow list item selection for sync jobs
 */
export type SyncJobListItem = Pick<
  SyncJobEntity,
  | 'id'
  | 'type'
  | 'status'
  | 'startTime'
  | 'endTime'
  | 'processedRecords'
  | 'failedRecords'
  | 'integrationCategory'
  | 'integrationId'
>

/**
 * SyncJobModel encapsulates CRUD for the SyncJob table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class SyncJobModel extends BaseModel<
  typeof SyncJob,
  CreateSyncJobInput,
  SyncJobEntity,
  UpdateSyncJobInput
> {
  /** Drizzle table */
  get table() {
    return SyncJob
  }

  /**
   * List recent sync jobs with a safe selection, ordered by most recent start time
   */
  async listRecent(input: { limit?: number } = {}): Promise<TypedResult<SyncJobListItem[], Error>> {
    try {
      this.requireOrgIfScoped()
      const limit = input.limit ?? 50

      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)

      let q = this.db
        .select({
          id: SyncJob.id,
          type: SyncJob.type,
          status: SyncJob.status,
          startTime: SyncJob.startTime,
          endTime: SyncJob.endTime,
          processedRecords: SyncJob.processedRecords,
          failedRecords: SyncJob.failedRecords,
          integrationCategory: SyncJob.integrationCategory,
          integrationId: SyncJob.integrationId,
        })
        .from(SyncJob)
        .$dynamic()

      if (whereParts.length) q = q.where(and(...whereParts))
      q = q.orderBy(desc(SyncJob.startTime)).limit(limit)

      const rows = await q
      return Result.ok(rows as SyncJobListItem[])
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
