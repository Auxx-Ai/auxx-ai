// apps/web/src/components/records/layout-editor/use-layout-editor.ts
'use client'

import {
  buildRegistryLayout,
  type RecordLayoutSurface,
  type ResolvedLayout,
} from '@auxx/lib/record-layout/client'
import {
  getDetailViewConfig,
  getEntityDrawerConfig,
  type LayoutBlock,
} from '@auxx/lib/resources/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanViewRecordResource } from '~/components/resources'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'
import { type LayoutEditorState, seedEditorState } from './editor-state'
import { diffEditorState, type LayoutSaveDeltas, serializeSaveDeltas } from './layout-diff'

/**
 * The layout editor's staged session (`plans/drawer/record-layout-system.md`
 * §9.6).
 *
 * Every edit stages locally and commits on Save, so Cancel and Esc discard the
 * whole session and the two mutations see one consistent write. The state is
 * seeded on the closed → open transition ONLY: re-seeding whenever a prop
 * identity changed would throw away edits the admin has staged but not saved,
 * which is the bug the `wasOpenRef` pattern in the dialog this replaces exists
 * to avoid.
 */

export interface UseLayoutEditorParams {
  open: boolean
  entityDefinitionId: string
  entityType: string
  surface: RecordLayoutSurface
  /** The layout as currently rendered, used to mirror the caller's tab set. */
  layout: ResolvedLayout
}

export interface UseLayoutEditorResult {
  /** The registry default layer, i.e. what the diff is taken against. */
  registry: ResolvedLayout
  state: LayoutEditorState
  /** Apply a reducer from `./editor-actions`. */
  update: (reducer: (state: LayoutEditorState) => LayoutEditorState) => void
  /** Every predefined block for this definition, by id. */
  catalog: Record<string, LayoutBlock>
  /** Whether the viewer may see a block, i.e. all of its registry gates pass. */
  isBlockVisible: (block: LayoutBlock) => boolean
  /** The two sparse deltas this session would write. */
  deltas: LayoutSaveDeltas
  /** Whether the org layer differs from what is stored. */
  orgDirty: boolean
  /** Whether the personal layer differs from what is stored. */
  personalDirty: boolean
  isLoading: boolean
}

/**
 * Build the registry default layer locally.
 *
 * It is code, it never round-trips, and computing it live is exactly what keeps
 * a shipped layout change from needing a migration. `canViewComments` is read
 * back off the caller's resolved layout rather than re-derived: the drawer drops
 * the Comments tab entirely when comment access is absent, and a registry layer
 * that disagreed with the surface it is editing would offer a tab that cannot
 * render.
 */
function useRegistryLayout(params: {
  entityType: string
  entityDefinitionId: string
  surface: RecordLayoutSurface
  layout: ResolvedLayout
}): ResolvedLayout {
  const { entityType, entityDefinitionId, surface, layout } = params
  const canViewComments = layout.tabs.some((tab) => tab.id === 'comments')

  return useMemo(
    () =>
      buildRegistryLayout({
        surface,
        entityType,
        drawerConfig: getEntityDrawerConfig(entityType, entityDefinitionId),
        detailConfig: surface === 'detail' ? getDetailViewConfig(entityType) : undefined,
        canViewComments,
      }),
    [surface, entityType, entityDefinitionId, canViewComments]
  )
}

/** Stage a layout editing session over the registry default and the stored deltas. */
export function useLayoutEditor(params: UseLayoutEditorParams): UseLayoutEditorResult {
  const { open, entityDefinitionId, entityType, surface, layout } = params

  const { can } = useAccess()
  const { hasAccess } = useFeatureFlags()
  const canViewRecordResource = useCanViewRecordResource()

  const registry = useRegistryLayout({ entityType, entityDefinitionId, surface, layout })

  const { data, isLoading } = api.recordLayout.get.useQuery(
    { entityDefinitionId, surface },
    { enabled: open && Boolean(entityDefinitionId) }
  )

  const [state, setState] = useState<LayoutEditorState>(() =>
    seedEditorState({ registry, orgDelta: data?.org, userDelta: data?.user })
  )
  /** The delta pair the session started from, for the dirty comparison. */
  const [baseline, setBaseline] = useState(() => serializeSaveDeltas({ org: {}, user: {} }))
  const wasOpenRef = useRef(false)
  const seededRef = useRef(false)

  // Seed ONCE per open session, as soon as the stored deltas have landed.
  //
  // The closed → open transition is the only trigger; `seededRef` is what makes
  // that "once", so a later refetch, a re-render or a new `registry` identity
  // cannot re-seed and discard staged edits. Waiting on `isLoading` is not a
  // second seed: the session simply has not started until the layers are known.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      seededRef.current = false
      return
    }
    wasOpenRef.current = true
    if (seededRef.current || isLoading) return

    const seeded = seedEditorState({ registry, orgDelta: data?.org, userDelta: data?.user })
    seededRef.current = true
    setState(seeded)
    setBaseline(serializeSaveDeltas(diffEditorState({ registry, state: seeded })))
  }, [open, isLoading, data, registry])

  const update = useCallback((reducer: (state: LayoutEditorState) => LayoutEditorState) => {
    setState((prev) => reducer(prev))
  }, [])

  const isBlockVisible = useCallback(
    (block: LayoutBlock) => {
      if (block.permissionKey && !can(block.permissionKey)) return false
      if (block.featureGate && !hasAccess(block.featureGate)) return false
      if (block.recordResource && !canViewRecordResource(block.recordResource)) return false
      return true
    },
    [can, hasAccess, canViewRecordResource]
  )

  const deltas = useMemo(() => diffEditorState({ registry, state }), [registry, state])
  const serialized = useMemo(() => serializeSaveDeltas(deltas), [deltas])

  return {
    registry,
    state,
    update,
    catalog: registry.blocksById,
    isBlockVisible,
    deltas,
    orgDirty: serialized.org !== baseline.org,
    personalDirty: serialized.user !== baseline.user,
    isLoading,
  }
}
