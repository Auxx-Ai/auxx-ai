// packages/types/actor/schema.ts

import { z } from 'zod'
import type { ActorId, ActorIdType } from './index'

/**
 * Zod schema for ActorId validation.
 * Validates format: `user:userId`, `group:groupId`, or `agent:agentId`.
 */
export const actorIdSchema = z.string().refine(
  (val) => {
    const parts = val.split(':')
    return parts.length === 2 && ['user', 'group', 'agent', 'worker'].includes(parts[0]!)
  },
  {
    message: 'ActorId must be in format user:id, group:id, agent:id, or worker:id',
  }
) as unknown as z.ZodType<ActorId>

/**
 * Zod schema for ActorIdType. System users share the `user:` prefix;
 * agents have their own `agent:` prefix keyed by `Agent.id`; dispatch workers use
 * `worker:` keyed by `DispatchWorker.id`.
 */
export const actorTypeSchema = z.enum([
  'user',
  'group',
  'agent',
  'worker',
]) as unknown as z.ZodType<ActorIdType>
