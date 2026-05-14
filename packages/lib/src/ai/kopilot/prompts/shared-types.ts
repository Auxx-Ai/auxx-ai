// packages/lib/src/ai/kopilot/prompts/shared-types.ts

import type { ActorId } from '@auxx/types/actor'

/**
 * Shared types for prompt modules. Extracted out of the old monolithic
 * `agent-prompt.ts` so `core-runtime-prompt.ts` and the persona modules
 * can both import them without a circular dependency.
 */

export interface EntityCatalogEntry {
  apiSlug: string
  label: string
  plural: string
  entityDefinitionId: string
}

export interface CurrentUserInfo {
  userId: string
  actorId: ActorId
  name: string | null
  email: string | null
  role: string
}
