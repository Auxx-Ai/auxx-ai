// apps/web/src/server/lib/snippet-instance-access.ts

import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
import {
  type PrivateInstanceListScope,
  privateInstanceListScope,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/capabilities/entity-access'

/**
 * The one authority for per-snippet instance access (plan 36 §6).
 *
 * Every snippet gate in the tree goes through this module so the read filter and
 * the write asserts can never disagree — the failure mode #1345 and #1359 both
 * hit is a list that shows an instance the detail route then 403s on (or, worse,
 * the reverse). `snippet-queries.ts` applies {@link snippetListScope} in SQL and
 * `snippet.ts` calls {@link assertSnippetAccess} on every id-bearing procedure;
 * both resolve through the same `CapabilitySet`.
 *
 * Deep imports rather than the `@auxx/lib/permissions` barrel: the barrel hangs
 * under vitest (HANDOFF standing gotcha), and router tests import this module
 * transitively.
 */

/** The `INSTANCE_ACCESS_RESOURCES` key snippets are registered under. */
export const SNIPPET_INSTANCE_KEY = 'snippet' as const

/**
 * The rung a snippet procedure needs.
 *  - `view`  — read it, insert it into a draft, count its usage.
 *  - `edit`  — change its title/content/description/folder/favorite flag.
 *  - `admin` — delete it, or change who it is shared with.
 */
export type SnippetAccessTier = 'view' | 'edit' | 'admin'

/**
 * Assert `tier` on one snippet id.
 *
 * There is no identifier resolution step (the agents/signatures equivalents need
 * one because they route by slug) — a snippet is only ever addressed by its
 * `Snippet.id`, so the id that reaches the assert is already the id the
 * `ResourceAccess` rows are keyed on. A foreign-org or non-existent id carries no
 * row for the caller and `snippet` is `baselineAtCreate: true`, so it denies
 * here rather than leaking the difference between "not yours" and "not there".
 *
 * @throws ForbiddenError when the tier is not met.
 */
export function assertSnippetAccess(
  capabilities: CapabilitySet,
  snippetId: string,
  tier: SnippetAccessTier
): void {
  if (tier === 'view') capabilities.assertViewInstance(SNIPPET_INSTANCE_KEY, snippetId)
  else if (tier === 'edit') capabilities.assertEditInstance(SNIPPET_INSTANCE_KEY, snippetId)
  else capabilities.assertAdminInstance(SNIPPET_INSTANCE_KEY, snippetId)
}

/**
 * The id filter for a snippet LIST query — the list-side twin of
 * {@link assertSnippetAccess} at the `view` tier, computed up front so it is
 * applied BEFORE any pagination or aggregation rather than by dropping rows
 * afterwards.
 *
 * `CapabilitySet.instanceListScope` is a **compile error** for `snippet` by
 * design: it is typed to `OrgSharedInstanceAccessKey`, and its `'exclude'` arm
 * is only sound when a row-less instance is visible — the exact thing
 * `baselineAtCreate: true` denies. This routes to the private-resource twin
 * instead, through the same serialized capability view the client resolver uses,
 * so server enforcement and client affordances read one implementation.
 */
export function snippetListScope(capabilities: CapabilitySet): PrivateInstanceListScope {
  return privateInstanceListScope(
    toResolvedRecordAccess(capabilities.toClientCapabilities()),
    SNIPPET_INSTANCE_KEY
  )
}
