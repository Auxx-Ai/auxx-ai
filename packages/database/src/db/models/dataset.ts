// packages/database/src/db/models/dataset.ts
// Dataset model (org-scoped) built on BaseModel

import { eq } from 'drizzle-orm'
import { Dataset } from '../schema/dataset'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Dataset entity type */
export type DatasetEntity = typeof Dataset.$inferSelect

/** Insertable Dataset input type */
export type CreateDatasetInput = typeof Dataset.$inferInsert

/** Updatable Dataset input type */
export type UpdateDatasetInput = Partial<CreateDatasetInput>

export class DatasetModel extends BaseModel<
  typeof Dataset,
  CreateDatasetInput,
  DatasetEntity,
  UpdateDatasetInput
> {
  get table() {
    return Dataset
  }

  async findByName(name: string): Promise<TypedResult<DatasetEntity | null, Error>> {
    try {
      const res = await this.findMany({ where: eq(Dataset.name, name), limit: 1 })
      if (!res.ok) return res as any
      return Result.ok(res.value![0] ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
