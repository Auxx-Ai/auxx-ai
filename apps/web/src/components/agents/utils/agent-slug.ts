// apps/web/src/components/agents/utils/agent-slug.ts

import { AGENT_SLUG_MAX } from '@auxx/lib/agents/client'

/**
 * Normalize a free-text string into a candidate agent slug. Strips diacritics-
 * lite, collapses whitespace/underscores into dashes, drops disallowed
 * characters, trims leading/trailing dashes, and clamps to the schema's
 * length cap. The resulting string still needs to pass `agentSlugSchema`
 * before being submitted (empty input → empty output).
 */
export function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, AGENT_SLUG_MAX)
}
