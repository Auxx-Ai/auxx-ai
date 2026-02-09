// packages/types/actor/schema.ts

import { z } from 'zod'
import type { ActorId, ActorType } from './index'

/**
 * Zod schema for ActorId validation.
 * Validates format: `user:userId` or `group:groupId`
 */
export const actorIdSchema = z
  .string()
  .refine(
    (val) => {
      const parts = val.split(':')
      return parts.length === 2 && ['user', 'group'].includes(parts[0]!)
    },
    {
      message: 'ActorId must be in format user:id or group:id',
    }
  ) as unknown as z.ZodType<ActorId>

/**
 * Zod schema for ActorType.
 */
export const actorTypeSchema = z.enum(['user', 'group']) as unknown as z.ZodType<ActorType>
