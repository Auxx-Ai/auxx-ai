// apps/web/src/components/permissions/hooks/use-agent-policy.ts
'use client'

import type { AgentAccessLevel, AgentPermissionPolicy, ExactAgentPolicy } from '@auxx/database'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Draft state for one `PermissionProfile.agentPolicy` (plan 19 §2.3).
 *
 * Pure — no network, no tRPC. The editor mutates a local copy and hands the whole
 * policy to ONE atomic `permissions.saveProfile` call (§6.1.4); there is
 * deliberately no per-row mutation, because a policy written across several
 * requests cannot be escalation-checked as one resulting state.
 *
 * Every setter speaks the SET semantics of the model, not the additive human one:
 * an override of `'none'` is a stored deny, and `undefined` means "remove the
 * override so this key follows its collection default" — which is itself always
 * one of the four exact rungs, never an absence.
 */

/** The `AgentPermissionPolicy` shape with its resource map narrowed for reads. */
export interface NormalizedAgentPolicy extends AgentPermissionPolicy {
  resources: Record<string, ExactAgentPolicy>
}

const LEVELS: ReadonlySet<string> = new Set(['none', 'read', 'read_write', 'full'])

/** Coerce one stored value into the closed vocabulary, or `null`. */
function parseLevel(raw: unknown): AgentAccessLevel | null {
  return typeof raw === 'string' && LEVELS.has(raw) ? (raw as AgentAccessLevel) : null
}

/**
 * Client mirror of the server's defensive parse (`profiles/agent-policy.ts`):
 * an unreadable `default` falls back to `fallback`, and override values outside
 * the vocabulary are dropped rather than guessed at. Kept here rather than
 * imported because `@auxx/lib/permissions/client` does not re-export the agent
 * policy helpers — see the note in the editor's report.
 */
function parseExact(raw: unknown, fallback: AgentAccessLevel): ExactAgentPolicy {
  const source = (raw ?? {}) as { default?: unknown; overrides?: unknown }
  const overrides: Record<string, AgentAccessLevel> = {}
  if (source.overrides && typeof source.overrides === 'object') {
    for (const [key, value] of Object.entries(source.overrides as Record<string, unknown>)) {
      const level = parseLevel(value)
      if (level) overrides[key] = level
    }
  }
  return { default: parseLevel(source.default) ?? fallback, overrides }
}

/**
 * Normalize a stored (or absent) policy into the total shape the grids render.
 *
 * A profile with no `agentPolicy` normalizes to all-`none` — fail closed, the
 * same direction `emptyAgentPolicy()` takes server-side. Never all-`full`: an
 * agent whose authority cannot be read must be inert, not omnipotent.
 */
export function normalizeAgentPolicy(
  raw: AgentPermissionPolicy | null | undefined
): NormalizedAgentPolicy {
  const source = (raw ?? {}) as Partial<AgentPermissionPolicy>
  const resourceDefault = parseLevel(source.resourceDefault) ?? 'none'
  const resources: Record<string, ExactAgentPolicy> = {}
  if (source.resources && typeof source.resources === 'object') {
    for (const [type, value] of Object.entries(source.resources)) {
      resources[type] = parseExact(value, resourceDefault)
    }
  }
  return {
    areas: parseExact(source.areas, 'none'),
    definitions: parseExact(source.definitions, 'none'),
    resourceDefault,
    resources,
  }
}

/** Stable serialization (sorted keys) so a jsonb round-trip never reads as dirty. */
function stableKey(policy: NormalizedAgentPolicy): string {
  const exact = (p: ExactAgentPolicy) => ({
    default: p.default,
    overrides: Object.keys(p.overrides)
      .sort()
      .map((k) => `${k}=${p.overrides[k]}`),
  })
  return JSON.stringify({
    areas: exact(policy.areas),
    definitions: exact(policy.definitions),
    resourceDefault: policy.resourceDefault,
    resources: Object.keys(policy.resources)
      .sort()
      .map((type) => ({ type, ...exact(policy.resources[type] as ExactAgentPolicy) })),
  })
}

/** How many individual rules differ between the saved policy and the draft. */
function countChanges(saved: NormalizedAgentPolicy, draft: NormalizedAgentPolicy): number {
  let changes = 0
  const diffExact = (a: ExactAgentPolicy, b: ExactAgentPolicy) => {
    if (a.default !== b.default) changes += 1
    for (const key of new Set([...Object.keys(a.overrides), ...Object.keys(b.overrides)])) {
      if (a.overrides[key] !== b.overrides[key]) changes += 1
    }
  }
  diffExact(saved.areas, draft.areas)
  diffExact(saved.definitions, draft.definitions)
  if (saved.resourceDefault !== draft.resourceDefault) changes += 1
  for (const type of new Set([...Object.keys(saved.resources), ...Object.keys(draft.resources)])) {
    const a = saved.resources[type]
    const b = draft.resources[type]
    if (!a || !b) {
      // A type entry that exists on one side only: its own default plus every
      // instance rule it carries are all changes.
      const present = a ?? b
      changes += 1 + Object.keys(present?.overrides ?? {}).length
      continue
    }
    diffExact(a, b)
  }
  return changes
}

/** The editor API returned by {@link useAgentPolicy}. */
export interface UseAgentPolicyResult {
  /** The live draft — always total, always one of the four rungs per lookup. */
  policy: NormalizedAgentPolicy
  /** Whether the draft differs from the last saved policy. */
  isDirty: boolean
  /** Number of individual rules that differ — drives the "N changes" chip. */
  changeCount: number
  /** Whether the profile had no stored policy at all (fail-closed start). */
  isNew: boolean
  /** Throw the draft away and re-seed from the saved policy. */
  reset: () => void
  /** Replace the default every unlisted area resolves to. */
  setAreasDefault: (level: AgentAccessLevel) => void
  /** Set (or, with `undefined`, remove) one area's override. */
  setAreaOverride: (area: string, level: AgentAccessLevel | undefined) => void
  /** Replace the default every unlisted entity definition resolves to. */
  setDefinitionsDefault: (level: AgentAccessLevel) => void
  /** Set (or remove) one definition's override, keyed by `apiSlug` (§3). */
  setDefinitionOverride: (apiSlug: string, level: AgentAccessLevel | undefined) => void
  /** Replace the posture for resource types with no rules of their own. */
  setResourceDefault: (level: AgentAccessLevel) => void
  /** Give one resource type its own default. */
  setResourceTypeDefault: (type: string, level: AgentAccessLevel) => void
  /**
   * Drop a resource type's entry so it follows `resourceDefault` again. Its
   * instance rules go with it — the shape has nowhere to keep them.
   */
  clearResourceType: (type: string) => void
  /**
   * Set (or remove) one instance's override. Materializes the type entry at the
   * current `resourceDefault` when the type had none, so an instance rule can
   * never exist without the type default that answers for its siblings.
   */
  setInstanceOverride: (
    type: string,
    instanceId: string,
    level: AgentAccessLevel | undefined
  ) => void
}

/**
 * Hold and edit one agent policy.
 *
 * Re-seeds whenever the saved policy actually changes (a refetch after save, or
 * the host switching profiles) — compared by value, not identity, so a
 * re-rendered parent never discards in-progress edits.
 */
export function useAgentPolicy(
  savedPolicy: AgentPermissionPolicy | null | undefined
): UseAgentPolicyResult {
  const saved = useMemo(() => normalizeAgentPolicy(savedPolicy), [savedPolicy])
  const savedKey = useMemo(() => stableKey(saved), [saved])
  const [draft, setDraft] = useState<NormalizedAgentPolicy>(saved)

  // Re-seed on a genuine change of the saved value only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `saved` is keyed by `savedKey`
  useEffect(() => setDraft(saved), [savedKey])

  const reset = useCallback(() => setDraft(saved), [saved])

  const patchExact = useCallback(
    (keyspace: 'areas' | 'definitions', apply: (current: ExactAgentPolicy) => ExactAgentPolicy) => {
      setDraft((prev) => ({ ...prev, [keyspace]: apply(prev[keyspace]) }))
    },
    []
  )

  const setOverride = useCallback(
    (keyspace: 'areas' | 'definitions', key: string, level: AgentAccessLevel | undefined) => {
      patchExact(keyspace, (current) => {
        const overrides = { ...current.overrides }
        if (level === undefined) delete overrides[key]
        else overrides[key] = level
        return { ...current, overrides }
      })
    },
    [patchExact]
  )

  const setAreasDefault = useCallback(
    (level: AgentAccessLevel) => patchExact('areas', (c) => ({ ...c, default: level })),
    [patchExact]
  )
  const setAreaOverride = useCallback(
    (area: string, level: AgentAccessLevel | undefined) => setOverride('areas', area, level),
    [setOverride]
  )
  const setDefinitionsDefault = useCallback(
    (level: AgentAccessLevel) => patchExact('definitions', (c) => ({ ...c, default: level })),
    [patchExact]
  )
  const setDefinitionOverride = useCallback(
    (apiSlug: string, level: AgentAccessLevel | undefined) =>
      setOverride('definitions', apiSlug, level),
    [setOverride]
  )

  const setResourceDefault = useCallback((level: AgentAccessLevel) => {
    setDraft((prev) => ({ ...prev, resourceDefault: level }))
  }, [])

  const setResourceTypeDefault = useCallback((type: string, level: AgentAccessLevel) => {
    setDraft((prev) => {
      const current = prev.resources[type] ?? { default: prev.resourceDefault, overrides: {} }
      return { ...prev, resources: { ...prev.resources, [type]: { ...current, default: level } } }
    })
  }, [])

  const clearResourceType = useCallback((type: string) => {
    setDraft((prev) => {
      const resources = { ...prev.resources }
      delete resources[type]
      return { ...prev, resources }
    })
  }, [])

  const setInstanceOverride = useCallback(
    (type: string, instanceId: string, level: AgentAccessLevel | undefined) => {
      setDraft((prev) => {
        const current = prev.resources[type] ?? { default: prev.resourceDefault, overrides: {} }
        const overrides = { ...current.overrides }
        if (level === undefined) delete overrides[instanceId]
        else overrides[instanceId] = level
        return { ...prev, resources: { ...prev.resources, [type]: { ...current, overrides } } }
      })
    },
    []
  )

  const draftKey = stableKey(draft)

  return {
    policy: draft,
    isDirty: draftKey !== savedKey,
    changeCount: countChanges(saved, draft),
    isNew: savedPolicy == null,
    reset,
    setAreasDefault,
    setAreaOverride,
    setDefinitionsDefault,
    setDefinitionOverride,
    setResourceDefault,
    setResourceTypeDefault,
    clearResourceType,
    setInstanceOverride,
  }
}
