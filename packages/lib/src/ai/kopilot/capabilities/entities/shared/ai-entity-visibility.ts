// packages/lib/src/ai/kopilot/capabilities/entities/shared/ai-entity-visibility.ts

import {
  isMailLensTableId,
  MAIL_LENS_REFUSAL,
} from '../../../../../resources/picker/mail-lens-tables'
import type { Resource } from '../../../../../resources/registry/types'

/**
 * What the AI may see and reach through the **generic record path**
 * (`list_entities`, `list_entity_fields`, `search_entities`, `query_records`,
 * `get_entity`, and the system prompt's entity catalog).
 *
 * Two independent decisions live here, and they compose in one direction only:
 * a blocked def is never AI-visible, whatever the allowlist says.
 *
 * **1. The block.** `thread` and `message` carry a per-member *lens*
 * (metadata / subject / full) that exists **only** in `mail-query/` —
 * `grep -rl Lens resources/crud/` returns nothing. `canViewEntity('thread')` is
 * an unconditional pass-through (`NON_RECORD_DEF_SLUGS`,
 * `permissions/capabilities/entity-access.ts`), so the generic record path has no
 * gate of its own to fall back on. A production turn called
 * `query_records({"entity":"threads","limit":5})` — the model routing around the
 * mail tools into the one path that applies no lens. The mail tools stay the only
 * door to conversation content.
 *
 * The blocked set itself is **not defined here**: it lives in
 * `resources/picker/mail-lens-tables` because the picker's `TableId`-driven reads
 * are the other half of the same restriction, and one security-relevant set that
 * two modules can drift apart on is how a hole reopens. This module only applies
 * it at the AI tool boundary and words the refusal for a model rather than for a
 * service caller.
 *
 * **2. The allowlist (`AI_VISIBLE_INFRA_DEFS`).** `EntityDefinition.isVisible`
 * means *"show in the Records nav"*, and three sites reused it as the AI's
 * capability boundary — which hid 14 of 23 defs in the dev org, including
 * inboxes, tags and catalog items the AI is perfectly entitled to read. Dropping
 * the `isVisible` filter outright is the wrong fix (Kopilot plan §9.1): for the
 * ten `NON_RECORD_DEF_SLUGS` there is no def-level gate at all, so it would
 * advertise threads, messages, datasets, articles, dashboards and workflows
 * through a gate that always returns true. Hence a curated list instead, keyed by
 * the stable system `entityType`, not by the renameable `apiSlug`.
 *
 * Neither of these is an authorization layer. Per-def and per-record enforcement
 * still runs in the tools (`canViewEntity` / `hasDefPresence` / the picker's
 * per-row narrowing); this module only decides what the AI is *told about* and
 * which door it must use.
 */

/**
 * Nav-hidden defs the AI may nevertheless discover and query. Each was picked
 * because its instance-level enforcement works, so exposing the *type* costs
 * nothing that the row-level gates don't already cover.
 *
 * `payment` / `line_item` are here on an explicit product decision (user,
 * 2026-07-31): the money-adjacent defs are ordinary `EntityInstance` defs whose
 * per-def and per-record gates apply exactly as the others', so "the AI may
 * enumerate payments" was the only open question and it is answered yes.
 *
 * Deliberately **excluded**: `thread` / `message` (no lens outside `mail-query/`
 * — see {@link isAiBlockedDefKey}), `personal_inbox` (private by construction),
 * `signature` (the exact def plan 36 had to close), and
 * `article` / `kb` / `dataset` / `dashboard` / `workflow` (own tools, plus the
 * `canViewEntity` pass-through).
 */
export const AI_VISIBLE_INFRA_DEFS: ReadonlySet<string> = new Set<string>([
  'inbox',
  'tag',
  'catalog_item',
  'catalog_group',
  'meeting',
  'payment',
  'line_item',
])

/**
 * The stable identity of a def, independent of how it was named.
 *
 * System resources (`thread`, `message`, `user`, …) have no `EntityDefinition`
 * row and carry `entityType === id === '<tableId>'`. Def-backed system types
 * (`inbox`, `tag`, `payment`, …) carry the org's CUID as `id` and the system slug
 * as `entityType`. User-authored defs have no `entityType`, so they key on their
 * CUID and can never collide with a curated entry.
 */
export function resourceDefKey(resource: Resource): string {
  return resource.entityType ?? resource.id
}

/**
 * Whether a def key names a def the generic record path refuses — the shared
 * mail-lens set, applied at the AI boundary.
 *
 * Keyed by the canonical def key ({@link resourceDefKey}), so every naming of the
 * same def is covered once the caller has resolved it: `thread`, `threads`,
 * `Threads`, the `threads` apiSlug and the `thread:<id>` RecordId prefix all land
 * on `thread`.
 */
export function isAiBlockedDefKey(key: string): boolean {
  return isMailLensTableId(key)
}

/**
 * Whether this resource is refused by the generic record path. Normalization-proof
 * by construction: the caller has already resolved whatever the model typed to a
 * `Resource`, and the check runs on the resolved identity.
 */
export function isAiBlockedResource(resource: Resource): boolean {
  return isAiBlockedDefKey(resourceDefKey(resource))
}

/**
 * Whether the AI may be *told about* this def — shown in `list_entities`, in the
 * prompt's entity catalog, and included in the global `search_entities` scope.
 *
 * Not an access check. The tools still gate on `canViewEntity` / `hasDefPresence`
 * per def and the picker still narrows per row.
 */
export function isAiVisibleResource(resource: Resource): boolean {
  if (isAiBlockedResource(resource)) return false
  if (resource.isVisible !== false) return true
  return AI_VISIBLE_INFRA_DEFS.has(resourceDefKey(resource))
}

/**
 * What the caller was trying to do, which decides *which* mail tool the refusal
 * names. `read` points at the mail search tools (`MAIL_LENS_REFUSAL`); `write`
 * points at `update_thread`, since telling a model that wanted to set a status
 * to "go and search" is the one hint guaranteed not to help.
 */
export type BlockedEntityIntent = 'read' | 'write'

/**
 * The write half of {@link MAIL_LENS_REFUSAL}. Worded here rather than beside it
 * because the blocked *set* is shared with the picker while this pointer is
 * AI-tool-specific — the picker has no `update_thread` to recommend.
 */
const MAIL_LENS_WRITE_REFUSAL =
  'Threads and messages are not writable through the generic record path — thread changes ' +
  '(status, assignee, tags) go through update_thread, which applies the mail visibility lens.'

/**
 * The refusal an AI tool returns for a blocked def. Names the tool the model
 * should have called, so it can self-correct in the same turn instead of
 * retrying the same door with a different spelling.
 *
 * @param named - the entity reference exactly as the model wrote it
 * @param intent - `read` (default) points at the mail search tools; `write`
 *   points at `update_thread`
 */
export function blockedEntityError(named: string, intent: BlockedEntityIntent = 'read'): string {
  const pointer = intent === 'write' ? MAIL_LENS_WRITE_REFUSAL : MAIL_LENS_REFUSAL
  const substitute = intent === 'write' ? 'record write' : 'record query'
  return (
    `Entity type "${named}" is not reachable through the record tools. ${pointer} ` +
    `If the mail tools are not available on this surface, say so rather than substituting a ` +
    `${substitute}.`
  )
}
