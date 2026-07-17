// apps/web/src/components/resources/utils/normalize-record-id.ts

'use client'

import {
  isStaticCanonicalDefinitionId,
  parseRecordId,
  type RecordId,
  resolveStaticPrefix,
  toRecordId,
} from '@auxx/lib/resources/client'
import { useMemo, useSyncExternalStore } from 'react'
import { useResourceStore } from '../store/resource-store'

/**
 * RecordId prefix canonicalization — two tiers:
 *
 * 1. Static tier (`@auxx/lib/resources/static-prefixes`): legacy system types
 *    (thread, message, …) and their apiSlugs resolve at build time — no seed,
 *    no store, no hydration.
 * 2. Dynamic tier (`resourceStore.definitionIdByPrefix`): def-backed
 *    entityTypes (`contact`, `work_order`, …), apiSlugs, and custom defs
 *    resolve to their EntityDefinition UUID via the org-specific map (seeded
 *    from dehydrated state, replaced on `resource.list` hydration).
 *
 * Field-value store keys embed the prefix verbatim, so a mismatch here causes
 * subscriptions to miss optimistic updates.
 */

// ─────────────────────────────────────────────────────────────────
// PREFIX EPOCH — reactivity primitive for normalization consumers
// ─────────────────────────────────────────────────────────────────

let prefixEpoch = 0
const epochListeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  // Bumps ONLY when prefix mappings actually change (setResources preserves
  // the map reference when mappings are identical), so field-metadata updates
  // never fan out to normalization consumers.
  useResourceStore.subscribe(
    (s) => s.definitionIdByPrefix,
    () => {
      prefixEpoch++
      for (const listener of epochListeners) listener()
    }
  )
}

function subscribeToPrefixEpoch(listener: () => void): () => void {
  epochListeners.add(listener)
  return () => epochListeners.delete(listener)
}

/**
 * Subscribe to the prefix-map epoch: a counter that increments exactly when
 * prefix mappings change. Memoize normalization results against it instead of
 * subscribing to the resource store — resource updates that don't change
 * mappings cost consumers nothing.
 */
export function usePrefixEpoch(): number {
  return useSyncExternalStore(
    subscribeToPrefixEpoch,
    () => prefixEpoch,
    () => 0
  )
}

// ─────────────────────────────────────────────────────────────────
// IMPERATIVE RESOLVERS
// ─────────────────────────────────────────────────────────────────

/**
 * Canonicalize a definition prefix (UUID | entityType | apiSlug) → canonical
 * entityDefinitionId. Static tier first, then the org-dynamic map. Returns
 * the input unchanged when neither tier knows it.
 */
export function getNormalizedDefinitionId(prefix: string): string {
  const staticCanonical = resolveStaticPrefix(prefix)
  if (staticCanonical) return staticCanonical
  return useResourceStore.getState().definitionIdByPrefix.get(prefix) ?? prefix
}

/**
 * True when the prefix is resolvable RIGHT NOW: statically canonical (legacy
 * system name or long-form definition id), statically aliased, or present in
 * the dynamic map. Known org-dynamic aliases return false until their mapping
 * is available — fetch gates hold those ids back.
 */
export function canNormalizeDefinitionId(prefix: string): boolean {
  if (resolveStaticPrefix(prefix)) return true
  if (useResourceStore.getState().definitionIdByPrefix.has(prefix)) return true
  return isStaticCanonicalDefinitionId(prefix)
}

/**
 * Imperative RecordId canonicalization — parses the id exactly once. No-op
 * when the prefix is unknown to both tiers.
 */
export function getNormalizedRecordId(recordId: RecordId): RecordId {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!entityDefinitionId || !entityInstanceId) return recordId
  const canonical = getNormalizedDefinitionId(entityDefinitionId)
  if (canonical === entityDefinitionId) return recordId
  return toRecordId(canonical, entityInstanceId)
}

/**
 * Canonicalize a RecordId, or return null when its prefix is not yet
 * resolvable (unknown dynamic alias pre-hydration). Single parse — use this
 * in drain/flush loops that must both normalize and gate.
 */
export function tryNormalizeRecordId(recordId: RecordId): RecordId | null {
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)
  if (!entityDefinitionId || !entityInstanceId) return null
  const staticCanonical = resolveStaticPrefix(entityDefinitionId)
  if (staticCanonical) {
    return staticCanonical === entityDefinitionId
      ? recordId
      : toRecordId(staticCanonical, entityInstanceId)
  }
  const mapped = useResourceStore.getState().definitionIdByPrefix.get(entityDefinitionId)
  if (mapped) {
    return mapped === entityDefinitionId ? recordId : toRecordId(mapped, entityInstanceId)
  }
  return isStaticCanonicalDefinitionId(entityDefinitionId) ? recordId : null
}

/** True when {@link tryNormalizeRecordId} would resolve this id. */
export function canNormalizeRecordId(recordId: RecordId): boolean {
  const { entityDefinitionId } = parseRecordId(recordId)
  if (!entityDefinitionId) return false
  return canNormalizeDefinitionId(entityDefinitionId)
}

// ─────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────

/**
 * Hook variant of {@link getNormalizedRecordId}. Recomputes when prefix
 * mappings change (seed → hydration transition, resource created/renamed),
 * without subscribing to the resource store itself.
 */
export function useNormalizedRecordId(recordId: RecordId): RecordId
export function useNormalizedRecordId(
  recordId: RecordId | null | undefined
): RecordId | null | undefined
export function useNormalizedRecordId(
  recordId: RecordId | null | undefined
): RecordId | null | undefined {
  const epoch = usePrefixEpoch()
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch invalidates the store-derived result
  return useMemo(() => {
    if (!recordId) return recordId
    return getNormalizedRecordId(recordId)
  }, [recordId, epoch])
}

/**
 * Plural variant of {@link useNormalizedRecordId}. Returns the input array
 * reference when nothing changed.
 */
export function useNormalizedRecordIds(recordIds: RecordId[]): RecordId[] {
  const epoch = usePrefixEpoch()
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch invalidates the store-derived result
  return useMemo(() => {
    let changed = false
    const normalized = recordIds.map((rid) => {
      const next = getNormalizedRecordId(rid)
      if (next !== rid) changed = true
      return next
    })
    return changed ? normalized : recordIds
  }, [recordIds, epoch])
}

/** Hook variant of {@link getNormalizedDefinitionId}. */
export function useNormalizedDefinitionId(prefix: string): string {
  const epoch = usePrefixEpoch()
  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch invalidates the store-derived result
  return useMemo(() => getNormalizedDefinitionId(prefix), [prefix, epoch])
}
