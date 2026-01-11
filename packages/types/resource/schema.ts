// packages/types/resource/schema.ts

import { z } from 'zod'

/**
 * Zod schema for ResourceRef validation
 */
export const resourceRefSchema = z.object({
  entityDefinitionId: z.string(),
  entityInstanceId: z.string(),
})
