// packages/lib/src/import/mapping/update-mapping.ts

import { eq } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/**
 * Input for updating mapping title.
 */
export interface UpdateMappingTitleInput {
  mappingId: string
  title: string
}

/**
 * Update a mapping's title (for template saving).
 *
 * @param db - Database instance
 * @param input - Mapping ID and new title
 */
export async function updateMappingTitle(
  db: Database,
  input: UpdateMappingTitleInput
): Promise<void> {
  await db
    .update(schema.ImportMapping)
    .set({
      title: input.title,
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportMapping.id, input.mappingId))
}
