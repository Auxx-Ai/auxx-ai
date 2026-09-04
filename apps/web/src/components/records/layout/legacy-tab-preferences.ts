// apps/web/src/components/records/layout/legacy-tab-preferences.ts

'use client'

/**
 * The drawer's pre-layout-system per-user tab preferences, read as a personal
 * layout delta (`plans/drawer/record-layout-system.md` §2).
 *
 * Per-user tab order and hiding shipped in localStorage under
 * `tabOrder:{org}:{user}:{def}` long before this system existed. The plan is
 * blunt about what that is: "layer 3 of this system already, in the wrong
 * store. It must be subsumed, not left running alongside, or order gets two
 * sources of truth."
 *
 * Subsuming it means exactly this module and nothing more. The legacy value is
 * translated into the same sparse delta shape the personal layer stores and
 * handed to the resolver as the user layer, so there is still one merge and one
 * answer. Nothing re-orders a resolved tab list afterwards.
 *
 * This is deliberately read-only and never migrates on mount. A stored personal
 * delta always outranks it, so the first save through the layout editor retires
 * the legacy key on its own, with no write-on-read and nothing to roll back if
 * that save fails.
 */

import type { RecordLayoutDelta } from '@auxx/lib/record-layout/client'
import { useMemo } from 'react'
import { safeLocalStorage } from '~/lib/safe-localstorage'

/** localStorage key the legacy preferences were written under. */
export function legacyTabPreferencesKey(
  organizationId: string | null | undefined,
  userId: string | null | undefined,
  entityDefinitionId: string | null | undefined
): string | null {
  if (!organizationId || !userId || !entityDefinitionId) return null
  return `tabOrder:${organizationId}:${userId}:${entityDefinitionId}`
}

/**
 * Parse a legacy value into a personal delta.
 *
 * Tolerates the two shapes that were ever written: a bare `string[]` of tab
 * values from before hiding existed, and `{ order, hidden }` after it. Anything
 * unparseable, or a value carrying neither key, yields `null` so the viewer
 * simply falls through to the registry order.
 */
export function parseLegacyTabPreferences(raw: string | null): RecordLayoutDelta | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const order = parsed.filter((value): value is string => typeof value === 'string')
      return order.length > 0 ? { tabs: { order } } : null
    }
    if (parsed && typeof parsed === 'object') {
      const source = parsed as { order?: unknown; hidden?: unknown }
      const order = Array.isArray(source.order)
        ? source.order.filter((value): value is string => typeof value === 'string')
        : []
      const hidden = Array.isArray(source.hidden)
        ? source.hidden.filter((value): value is string => typeof value === 'string')
        : []
      if (order.length === 0 && hidden.length === 0) return null
      return { tabs: { ...(order.length > 0 && { order }), ...(hidden.length > 0 && { hidden }) } }
    }
  } catch {
    // Invalid JSON. Fall through to the registry order.
  }
  return null
}

/**
 * The legacy preferences for one definition, as a personal delta to feed
 * {@link import('./use-record-layout').useRecordLayout}'s `fallbackUserDelta`.
 */
export function useLegacyTabPreferences(
  organizationId: string | null | undefined,
  userId: string | null | undefined,
  entityDefinitionId: string | null | undefined
): RecordLayoutDelta | null {
  return useMemo(() => {
    const key = legacyTabPreferencesKey(organizationId, userId, entityDefinitionId)
    if (!key) return null
    return parseLegacyTabPreferences(safeLocalStorage.get(key))
  }, [organizationId, userId, entityDefinitionId])
}
