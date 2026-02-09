// packages/types/resource/schema.ts

import { z } from 'zod'
import type { RecordId } from './index'

/**
 * Zod schema for RecordId validation.
 * Validates format: `entityDefinitionId:entityInstanceId`
 */
export const recordIdSchema = z
  .string()
  .refine((val) => val.includes(':') && val.split(':').length >= 2, {
    message: 'RecordId must be in format entityDefinitionId:entityInstanceId',
  }) as unknown as z.ZodType<RecordId>
