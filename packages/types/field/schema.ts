// packages/types/field/schema.ts

import { z } from 'zod'
import type { FieldId, ResourceFieldId } from './index'

/**
 * Zod schema for FieldId validation.
 * Accepts any non-empty string (UUIDs for custom fields, keys for system fields)
 */
export const fieldIdSchema = z
  .string()
  .min(1, 'FieldId must not be empty') as unknown as z.ZodType<FieldId>

/**
 * Zod schema for ResourceFieldId validation.
 * Validates format: `entityDefinitionId:fieldId`
 */
export const resourceFieldIdSchema = z
  .string()
  .refine((val) => val.includes(':') && val.split(':').length >= 2, {
    message: 'ResourceFieldId must be in format entityDefinitionId:fieldId',
  }) as unknown as z.ZodType<ResourceFieldId>
