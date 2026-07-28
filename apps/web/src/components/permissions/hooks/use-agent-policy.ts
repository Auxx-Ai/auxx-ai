// apps/web/src/components/permissions/hooks/use-agent-policy.ts
'use client'

import type { AgentPermissionPolicy, ExactAgentPolicy } from '@auxx/database'
import { type ResourcePermission, ResourcePermissionValues } from '@auxx/database/enums'
import { INSTANCE_ACCESS_RESOURCES, type InstanceAccessKey } from '@auxx/lib/permissions/client'
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

const LEVELS: ReadonlySet<string> = new Set<string>(ResourcePermissionValues)

/** Coerce one stored value into the closed vocabulary, or `null`. */
function parseLevel(raw: unknown): ResourcePermission | null {
  return typeof raw === 'string' && LEVELS.has(raw) ? (raw as ResourcePermission) : null
}

/**
 * Client mirror of the server's defensive parse (`profiles/agent-policy.ts`):
 * an unreadable `default` falls back to `fallback`, and override values outside
 * the vocabulary are dropped rather than guessed at. Kept here rather than
 * imported because `@auxx/lib/permissions/client` does not re-export the agent
 * policy helpers — see the note in the editor's report.
 */
function parseExact(raw: unknown, fallback: ResourcePermission): ExactAgentPolicy {
  const source = (raw ?? {}) as { default?: unknown; overrides?: unknown }
  const overrides: Record<string, ResourcePermission> = {}
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
  const resources: Record<string, ExactAgentPolicy> = {}
  if (source.resources && typeof source.resources === 'object') {
    for (const [type, value] of Object.entries(source.resources)) {
      resources[type] = parseExact(value, 'none')
    }
  }
  return {
    areas: parseExact(source.areas, 'none'),
    definitions: parseExact(source.definitions, 'none'),
    resources,
  }
}

/**
 * What a resource type with no rule of its own resolves to: its own L2 area rung
 * (`INSTANCE_ACCESS_RESOURCES`), the same fall-through a human's absent
 * `ResourceAccess` row takes. Client mirror of `resourceTypeAreaLevel` in
 * `profiles/agent-policy.ts`.
 *
 * There is no separate "resource default" to consult — that field is gone, and
 * with it the second blanket dropdown that answered the same question one level
 * above the area rung it was then intersected with.
 */
export function resourceTypeAreaLevel(
  policy: NormalizedAgentPolicy,
  type: string
): ResourcePermission {
  const config = INSTANCE_ACCESS_RESOURCES[type as InstanceAccessKey]
  if (!config) return 'none'
  return policy.areas.overrides[config.area] ?? policy.areas.default
}

/**
 * Stable serialization (sorted keys) so a jsonb round-trip never reads as dirty.
 *
 * Exported for the plan 29 §5 round-trip test — a policy authored on the old
 * screen and re-rendered on the unified tree must produce an unchanged key.
 */
export function stableKey(policy: NormalizedAgentPolicy): string {
  const exact = (p: ExactAgentPolicy) => ({
    default: p.default,
    overrides: Object.keys(p.overrides)
      .sort()
      .map((k) => `${k}=${p.overrides[k]}`),
  })
  return JSON.stringify({
    areas: exact(policy.areas),
    definitions: exact(policy.definitions),
    resources: Object.keys(policy.resources)
      .sort()
      .map((type) => ({ type, ...exact(policy.resources[type] as ExactAgentPolicy) })),
  })
}

/**
 * How many individual rules differ between the saved policy and the draft.
 *
 * Exported for the plan 29 §5 round-trip test — re-rendering an unedited policy
 * on the unified tree must leave this at `0`.
 */
export function countChanges(saved: NormalizedAgentPolicy, draft: NormalizedAgentPolicy): number {
  let changes = 0
  const diffExact = (a: ExactAgentPolicy, b: ExactAgentPolicy) => {
    if (a.default !== b.default) changes += 1
    for (const key of new Set([...Object.keys(a.overrides), ...Object.keys(b.overrides)])) {
      if (a.overrides[key] !== b.overrides[key]) changes += 1
    }
  }
  diffExact(saved.areas, draft.areas)
  diffExact(saved.definitions, draft.definitions)
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
  setAreasDefault: (level: ResourcePermission) => void
  /** Set (or, with `undefined`, remove) one area's override. */
  setAreaOverride: (area: string, level: ResourcePermission | undefined) => void
  /** Replace the default every unlisted entity definition resolves to. */
  setDefinitionsDefault: (level: ResourcePermission) => void
  /** Set (or remove) one definition's override, keyed by `apiSlug` (§3). */
  setDefinitionOverride: (apiSlug: string, level: ResourcePermission | undefined) => void
  /** Give one resource type its own default. */
  setResourceTypeDefault: (type: string, level: ResourcePermission) => void
  /**
   * Drop a resource type's entry so it follows its L2 area again. Its instance
   * rules go with it — the shape has nowhere to keep them.
   */
  clearResourceType: (type: string) => void
  /**
   * Set (or remove) one instance's override. Materializes the type entry at the
   * type's current fall-through (its area rung) when the type had none, so an
   * instance rule can never exist without the type default that answers for its
   * siblings.
   */
  setInstanceOverride: (
    type: string,
    instanceId: string,
    level: ResourcePermission | undefined
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
    (keyspace: 'areas' | 'definitions', key: string, level: ResourcePermission | undefined) => {
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
    (level: ResourcePermission) => patchExact('areas', (c) => ({ ...c, default: level })),
    [patchExact]
  )
  const setAreaOverride = useCallback(
    (area: string, level: ResourcePermission | undefined) => setOverride('areas', area, level),
    [setOverride]
  )
  const setDefinitionsDefault = useCallback(
    (level: ResourcePermission) => patchExact('definitions', (c) => ({ ...c, default: level })),
    [patchExact]
  )
  const setDefinitionOverride = useCallback(
    (apiSlug: string, level: ResourcePermission | undefined) =>
      setOverride('definitions', apiSlug, level),
    [setOverride]
  )

  const setResourceTypeDefault = useCallback((type: string, level: ResourcePermission) => {
    setDraft((prev) => {
      const current = prev.resources[type] ?? {
        default: resourceTypeAreaLevel(prev, type),
        overrides: {},
      }
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
    (type: string, instanceId: string, level: ResourcePermission | undefined) => {
      setDraft((prev) => {
        const current = prev.resources[type] ?? {
          default: resourceTypeAreaLevel(prev, type),
          overrides: {},
        }
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
    setResourceTypeDefault,
    clearResourceType,
    setInstanceOverride,
  }
}
