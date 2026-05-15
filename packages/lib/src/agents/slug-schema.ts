// packages/lib/src/agents/slug-schema.ts

import { z } from 'zod'

export const AGENT_SLUG_REGEX = /^[a-z0-9-]+$/
export const AGENT_SLUG_MAX = 60

export const agentSlugSchema = z
  .string()
  .min(1)
  .max(AGENT_SLUG_MAX)
  .regex(AGENT_SLUG_REGEX, 'Slug must be lowercase letters, digits, and dashes')
