// packages/lib/src/import/mapping/update-mapping.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { BadRequestError } from '../../errors'
import type { ImportStrategyMode } from '../types/mapping'
import { isImportStrategyMode } from './strategy-mode'

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

/** Input for setting a job's import mode. */
export interface UpdateImportStrategyInput {
  mappingId: string
  mode: ImportStrategyMode
}

/**
 * Set `ImportMapping.defaultStrategy`, the job-level import mode.
 *
 * | Mode               | Matched row            | Unmatched row               |
 * | ------------------ | ---------------------- | --------------------------- |
 * | `create`           | create a second record | create                      |
 * | `update`           | update                 | skip, reported as UNMATCHED |
 * | `create-or-update` | update                 | create                      |
 *
 * This is the EXPLICIT writer. The mode also moves on its own when the
 * identifier set crosses between empty and non-empty (`syncMappingIdentity`),
 * but only on that transition, precisely so a choice made here is never
 * stomped by a later edit to some unrelated column.
 *
 * Deliberately does NOT reset `allowPlanGeneration`. The mode changes how the
 * PLAN classifies rows, not how cell values resolve; clearing the flag would
 * push the user back through value resolution for a choice that invalidates
 * nothing they resolved. Regenerating the plan is a separate, explicit step.
 *
 * @param db - Database instance
 * @param input - Mapping ID and mode
 * @throws BadRequestError when `mode` is not one of the three live modes
 */
export async function updateImportStrategy(
  db: Database,
  input: UpdateImportStrategyInput
): Promise<void> {
  if (!isImportStrategyMode(input.mode)) {
    throw new BadRequestError(
      `"${input.mode}" is not an import mode (create, update, create-or-update).`
    )
  }

  await db
    .update(schema.ImportMapping)
    .set({ defaultStrategy: input.mode, updatedAt: new Date() })
    .where(eq(schema.ImportMapping.id, input.mappingId))
}
