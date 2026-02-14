// packages/database/src/db/models/tag.ts
// Tag model (org-scoped) built on BaseModel

import { eq } from 'drizzle-orm'
import { Tag } from '../schema/tag'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Tag entity type */
export type TagEntity = typeof Tag.$inferSelect

/** Insertable Tag input type */
export type CreateTagInput = typeof Tag.$inferInsert

/** Updatable Tag input type */
export type UpdateTagInput = Partial<CreateTagInput>

export class TagModel extends BaseModel<typeof Tag, CreateTagInput, TagEntity, UpdateTagInput> {
  get table() {
    return Tag
  }

  async findByName(name: string): Promise<TypedResult<TagEntity | null, Error>> {
    try {
      const res = await this.findMany({ where: eq(Tag.title, name), limit: 1 })
      if (!res.ok) return res
      return Result.ok(res.value[0] ?? null)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
