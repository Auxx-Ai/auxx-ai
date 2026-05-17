// apps/web/src/components/agents/ui/detail/knowledge/derive-scope-mode.ts

import type { AgentDetail } from '../../../store/agent-store'

export type EffectiveScopeMode =
  | 'include_descendants'
  | 'include_one'
  | 'exclude'
  | 'inherited_include_descendants'
  | 'inherited_exclude'
  | 'none'

export interface AncestorContext {
  /**
   * Ordered nearest-first. Each entry is a recordId string like `'kb:abc'` or
   * `'article:xyz'`. The closest ancestor with an inheritable rule wins.
   */
  ancestorRecordIds: string[]
}

interface ScopeRow {
  recordId: string
  mode: 'include_descendants' | 'include_one' | 'exclude'
}

/**
 * Find the stored mode for a single `recordId` (instance or definition). When
 * no row exists, returns `'none'`. Strict per-row lookup — does not walk
 * ancestors. Use {@link deriveEffectiveMode} when you need inheritance.
 *
 * @param recordId  `'article:abc'` for instance, `'article'` for definition-level
 */
export function findStoredMode(
  scopes: ReadonlyArray<ScopeRow>,
  recordId: string
): EffectiveScopeMode {
  const row = scopes.find((s) => s.recordId === recordId)
  return row?.mode ?? 'none'
}

/**
 * Derive the *effective* mode for a record. Order of precedence:
 *
 *   1. An explicit row on this exact recordId.
 *   2. The closest ancestor (nearest-first) whose row is `include_descendants`
 *      or `exclude` — both flagged as `inherited_*` in the result. `include_one`
 *      on an ancestor does NOT inherit (it only covers the ancestor itself).
 *   3. A definition-level row (entityDefinitionId without instance) —
 *      flagged as inherited.
 *   4. `'none'`.
 */
export function deriveEffectiveMode(
  scopes: AgentDetail['knowledge'],
  recordId: string,
  ancestors?: AncestorContext
): EffectiveScopeMode {
  const own = findStoredMode(scopes, recordId)
  if (own !== 'none') return own

  for (const ancestorId of ancestors?.ancestorRecordIds ?? []) {
    const m = findStoredMode(scopes, ancestorId)
    if (m === 'include_descendants') return 'inherited_include_descendants'
    if (m === 'exclude') return 'inherited_exclude'
  }

  const colon = recordId.indexOf(':')
  const entityDefinitionId = colon === -1 ? recordId : recordId.slice(0, colon)
  if (entityDefinitionId !== recordId) {
    const defMode = findStoredMode(scopes, entityDefinitionId)
    if (defMode === 'include_descendants') return 'inherited_include_descendants'
    if (defMode === 'exclude') return 'inherited_exclude'
  }

  return 'none'
}
