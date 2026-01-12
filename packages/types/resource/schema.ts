// packages/types/resource/schema.ts

import { z } from 'zod'
import type { ResourceId } from './index'

/**
 * Zod schema for ResourceId validation.
 * Validates format: `entityDefinitionId:entityInstanceId`
 */
export const resourceIdSchema = z
  .string()
  .refine((val) => val.includes(':') && val.split(':').length >= 2, {
    message: 'ResourceId must be in format entityDefinitionId:entityInstanceId',
  }) as z.ZodType<ResourceId>
