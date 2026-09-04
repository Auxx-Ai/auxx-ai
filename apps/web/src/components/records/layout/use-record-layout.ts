// apps/web/src/components/records/layout/use-record-layout.ts

'use client'

import {
  buildRegistryLayout,
  type RecordLayoutDelta,
  type RecordLayoutSurface,
  type RegistryLayoutInput,
  type RelationTargetResolver,
  type ResolvedLayout,
  recordLayoutDeltaSchema,
  resolveRecordLayout,
} from '@auxx/lib/record-layout/client'
import { useMemo } from 'react'
import { useOrgFieldView } from '~/components/dynamic-table/stores/store-selectors'
import { api } from '~/trpc/react'

/**
 * Read a record surface's resolved layout for the current viewer
 * (`plans/drawer/record-layout-system.md` §5/§6).
 *
 * The registry default layer is built **locally** on every render: it is code,
 * it never round-trips, and computing it live is exactly what keeps a shipped
 * layout change from needing a migration. Only the two sparse deltas come from
 * the server.
 *
 * The org delta is served from the already-hydrated view store where possible.
 * `tableView.listAll` returns every context type and buckets rows by `tableId`,
 * and a record layout is stored under `tableId = entityDefinitionId` with
 * `contextType = surface`, so `useOrgFieldView` finds it with no extra query and
 * no waterfall. The `recordLayout.get` query is still issued for the personal
 * layer (which lives in `TableViewPreference`) and backfills the org layer if
 * the store has not hydrated yet.
 */

export interface UseRecordLayoutParams {
  /** Definition the layout belongs to. Falsy disables the query. */
  entityDefinitionId: string | null | undefined
  /** The definition's entity type, used to pick the registry entry. */
  entityType: string
  surface: RecordLayoutSurface
  /** Registry drawer config, for the drawer surface. */
  drawerConfig?: RegistryLayoutInput['drawerConfig']
  /** Registry detail-view config, for the detail surface. */
  detailConfig?: RegistryLayoutInput['detailConfig']
  /** True when the viewer may see the Comments tab. */
  canViewComments?: boolean
  /** Resolve an inverse relationship attribute to the definition it lists. */
  resolveRelationTarget?: RelationTargetResolver
  /**
   * Personal delta to use while the viewer has none stored server-side.
   *
   * The drawer's per-user tab order and hiding shipped in localStorage under
   * `tabOrder:{org}:{user}:{def}` before this system existed. That is layer 3
   * already, in the wrong store, and the plan is explicit that it must be
   * SUBSUMED rather than left running alongside, or tab order gets two sources
   * of truth (§2). Feeding it in here is what subsumes it: the legacy value
   * enters as the user layer and is merged by the one resolver, so nothing
   * downstream re-orders anything. A real stored personal delta always wins,
   * which is what retires the legacy key the first time the viewer saves.
   */
  fallbackUserDelta?: RecordLayoutDelta | null
}

export interface UseRecordLayoutResult {
  layout: ResolvedLayout
  /** True while the stored deltas are still in flight. */
  isLoading: boolean
}

/** Resolve the registry default plus the org and personal deltas into one layout. */
export function useRecordLayout(params: UseRecordLayoutParams): UseRecordLayoutResult {
  const {
    entityDefinitionId,
    entityType,
    surface,
    drawerConfig,
    detailConfig,
    canViewComments,
    resolveRelationTarget,
    fallbackUserDelta,
  } = params

  const storedOrgView = useOrgFieldView(entityDefinitionId ?? '', surface)

  const { data, isLoading } = api.recordLayout.get.useQuery(
    { entityDefinitionId: entityDefinitionId ?? '', surface },
    { enabled: Boolean(entityDefinitionId) }
  )

  const registry = useMemo(
    () =>
      buildRegistryLayout({
        surface,
        entityType,
        drawerConfig,
        detailConfig,
        canViewComments,
      }),
    [surface, entityType, drawerConfig, detailConfig, canViewComments]
  )

  // The store row is jsonb the client has never validated, so it is parsed
  // rather than cast. A row that no longer validates falls back to the registry
  // default instead of breaking the surface.
  const hydratedOrgDelta = useMemo(() => {
    if (!storedOrgView) return null
    const parsed = recordLayoutDeltaSchema.safeParse(storedOrgView.config)
    return parsed.success ? parsed.data : null
  }, [storedOrgView])

  const orgDelta = data?.org ?? hydratedOrgDelta
  // The fallback applies whenever there is no stored personal delta, not just
  // while the query is in flight: a viewer who has never saved reads `null`
  // forever, and that is exactly the viewer whose legacy localStorage order has
  // to keep applying.
  const userDelta = data?.user ?? fallbackUserDelta ?? null

  const layout = useMemo(
    () => resolveRecordLayout({ registry, orgDelta, userDelta, resolveRelationTarget }),
    [registry, orgDelta, userDelta, resolveRelationTarget]
  )

  return { layout, isLoading: Boolean(entityDefinitionId) && isLoading }
}

/**
 * The four layout writes, with the `recordLayout.get` cache invalidated after
 * each so the surface re-resolves.
 *
 * Every one of these takes a SPARSE delta. A caller that assembles a full
 * snapshot from a resolved layout and saves it back reintroduces the migration
 * treadmill (`plans/view-config/layered-view-config.md` §2.1): save only the
 * keys the editor actually changed.
 */
export function useSaveRecordLayout(params: {
  entityDefinitionId: string
  surface: RecordLayoutSurface
}) {
  const utils = api.useUtils()
  const invalidate = () => utils.recordLayout.get.invalidate(params)

  const saveOrg = api.recordLayout.saveOrg.useMutation({ onSuccess: invalidate })
  const savePersonal = api.recordLayout.savePersonal.useMutation({ onSuccess: invalidate })
  const resetOrg = api.recordLayout.resetOrg.useMutation({ onSuccess: invalidate })
  const resetPersonal = api.recordLayout.resetPersonal.useMutation({ onSuccess: invalidate })

  return {
    saveOrg,
    savePersonal,
    resetOrg,
    resetPersonal,
    /** Write the org layout. Def-admin only; this changes the surface for everyone. */
    saveOrgDelta: (delta: RecordLayoutDelta) => saveOrg.mutateAsync({ ...params, delta }),
    /** Write the acting member's own layout. */
    savePersonalDelta: (delta: RecordLayoutDelta) => savePersonal.mutateAsync({ ...params, delta }),
    /** Delete the org layout, returning the surface to the registry default. */
    resetOrgLayout: () => resetOrg.mutateAsync(params),
    /** Delete the acting member's own layout. */
    resetPersonalLayout: () => resetPersonal.mutateAsync(params),
  }
}
