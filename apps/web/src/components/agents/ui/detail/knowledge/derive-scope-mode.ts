// apps/web/src/components/agents/ui/detail/knowledge/derive-scope-mode.ts

import type { AgentDetail } from '../../../store/agent-store'

export type EffectiveScopeMode = 'include_descendants' | 'include_one' | 'exclude' | 'none'

interface ScopeRow {
  entityDefinitionId: string
  entityInstanceId: string | null
  mode: 'include_descendants' | 'include_one' | 'exclude'
}

/**
 * Find the stored mode for a single `recordId` (instance or definition). When
 * no row exists, returns `'none'`. Matches the planned client-side resolver
 * approximation — strict per-row lookup, no inheritance flattening yet.
 *
 * @param recordId  `'article:abc'` for instance, `'article'` for definition-level
 */
export function findStoredMode(
  scopes: ReadonlyArray<ScopeRow>,
  recordId: string
): EffectiveScopeMode {
  const { entityDefinitionId, entityInstanceId } = splitRecordId(recordId)
  const row = scopes.find(
    (s) => s.entityDefinitionId === entityDefinitionId && s.entityInstanceId === entityInstanceId
  )
  return row?.mode ?? 'none'
}

/**
 * Derive the *effective* mode for a record by walking definition-level then
 * instance-level rules in order. Instance rules win over definition rules.
 */
export function deriveEffectiveMode(
  scopes: AgentDetail['resourceScopes'],
  recordId: string
): EffectiveScopeMode {
  const { entityDefinitionId, entityInstanceId } = splitRecordId(recordId)

  let mode: EffectiveScopeMode = 'none'

  // Apply definition-level rule first.
  const defRow = scopes.find(
    (s) => s.entityDefinitionId === entityDefinitionId && s.entityInstanceId === null
  )
  if (defRow) {
    if (defRow.mode === 'include_descendants') mode = 'include_descendants'
    else if (defRow.mode === 'exclude') mode = 'exclude'
    else if (defRow.mode === 'include_one') mode = 'include_one'
  }

  // Instance-level rule wins if present.
  if (entityInstanceId !== null) {
    const instanceRow = scopes.find(
      (s) => s.entityDefinitionId === entityDefinitionId && s.entityInstanceId === entityInstanceId
    )
    if (instanceRow) mode = instanceRow.mode
  }

  return mode
}

function splitRecordId(recordId: string): {
  entityDefinitionId: string
  entityInstanceId: string | null
} {
  const colon = recordId.indexOf(':')
  if (colon === -1) return { entityDefinitionId: recordId, entityInstanceId: null }
  const def = recordId.slice(0, colon)
  const instance = recordId.slice(colon + 1)
  return { entityDefinitionId: def, entityInstanceId: instance.length > 0 ? instance : null }
}
