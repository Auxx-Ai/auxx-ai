// apps/web/src/components/fields/hooks/use-field-view-draft.ts
'use client'

import {
  createDefaultFieldViewConfig,
  type FieldGroup,
  type FieldViewConfig,
  type ViewContextType,
} from '@auxx/lib/conditions/client'
import { isTrailingMetadataField, type ResourceField } from '@auxx/lib/resources/client'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { useCallback, useMemo, useState } from 'react'
import { useDynamicTableStore } from '~/components/dynamic-table/stores/dynamic-table-store'
import { useOrgFieldView } from '~/components/dynamic-table/stores/store-selectors'
import {
  assignFieldToGroupInOrder,
  moveFieldToSlot,
  moveGroupBlock,
  normalizeGroupContiguity,
  resolveEmptyGroupAnchor,
} from '~/components/fields/group-fields'
import { resolveFieldVisible } from '~/components/fields/hooks/use-field-view'
import { mergeFieldOrder } from '~/components/fields/merge-field-order'
import { api } from '~/trpc/react'

/** Stable empty array so `draftGroups` keeps referential identity across renders. */
const NO_GROUPS: FieldGroup[] = []

export interface UseFieldViewDraftOptions {
  entityDefinitionId: string
  /** The context this surface edits by default. */
  contextType: ViewContextType
  /** The full candidate field list for this surface, in baseline order. */
  fields: ResourceField[]
}

export interface UseFieldViewDraftResult {
  /** Null when not in draft mode. */
  draft: FieldViewConfig | null
  isDraftMode: boolean
  /**
   * Whether the draft differs from the snapshot draft mode opened with. False
   * outside draft mode. Lets a surface skip the "save or discard?" prompt when
   * the user only looked around.
   */
  isDraftDirty: boolean
  isSaving: boolean
  /** Which context the draft is currently editing (may differ from `contextType`). */
  draftContextType: ViewContextType
  enterDraft: () => void
  cancelDraft: () => void
  /** Re-snapshot for a different context (the dialog's Create/Edit toggle). */
  switchDraftContext: (contextType: ViewContextType) => void
  setDraftVisibility: (resourceFieldId: string, visible: boolean) => void
  /**
   * Move `activeId` to `overId`'s slot within draft.fieldOrder. No-op if either
   * is absent. `edge` names which side of `overId` the field lands on; omit it
   * for dnd-kit's direction-dependent `arrayMove` semantics, which is what a
   * flat `SortableContext` drag wants. See {@link moveFieldToSlot}.
   */
  reorderDraft: (activeId: string, overId: string, edge?: 'before' | 'after') => void
  /**
   * Persist the draft: update the existing org default view, or create one.
   * Never rejects — resolves `true` when the write landed (and draft mode has
   * exited), `false` when it failed and the draft was left intact.
   */
  saveDraft: () => Promise<boolean>
  /** Groups in the draft. Empty array when the draft has none. */
  draftGroups: FieldGroup[]
  /** Create a group; returns its new id. */
  addGroup: (label: string) => string
  renameGroup: (groupId: string, label: string) => void
  /** Delete a group; its members become ungrouped (never delete the fields). */
  deleteGroup: (groupId: string) => void
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  /** Move a field into a group, or out of all groups with `null`. */
  assignFieldToGroup: (fieldId: string, groupId: string | null) => void
  /** Move a whole group block to `overId`'s position. `overIsGroup` distinguishes a group target from a field target. */
  moveGroup: (groupId: string, overId: string, overIsGroup: boolean) => void
}

/** Name for a lazily created org default view, per context. */
function defaultViewNameForContext(contextType: ViewContextType): string {
  if (contextType === 'panel') return 'Default Panel View'
  if (contextType === 'dialog_create' || contextType === 'dialog_edit') return 'Default Dialog View'
  return 'Default Field View'
}

/**
 * Draft-buffer editing of a `FieldViewConfig` (the org's default shared view for
 * a context), shared by the record dialog and the property-panel drawer.
 *
 * Edits are local until `saveDraft` — a single config write covers both
 * visibility and order, so a half-configured view is never live for other users
 * and Cancel is a real affordance. Field ORDER lives in `FieldViewConfig.fieldOrder`
 * and nowhere else; nothing here writes `CustomField.sortOrder`.
 */
export function useFieldViewDraft({
  entityDefinitionId,
  contextType,
  fields,
}: UseFieldViewDraftOptions): UseFieldViewDraftResult {
  /** Whether draft mode is active */
  const [isDraftMode, setIsDraftMode] = useState(false)

  /** Which context is being edited (independent of the surface's own context) */
  const [draftContextType, setDraftContextType] = useState<ViewContextType>(contextType)

  /** Draft config: local buffer for batch save (null when not in draft mode) */
  const [draft, setDraft] = useState<FieldViewConfig | null>(null)

  /**
   * The snapshot draft mode opened with, serialized — the baseline `isDraftDirty`
   * compares against. Null outside draft mode.
   */
  const [pristineConfig, setPristineConfig] = useState<string | null>(null)

  // Field IDs for creating default configs
  const fieldIds = useMemo(
    () => fields.map((f) => String(f.resourceFieldId ?? f.id ?? f.key)),
    [fields]
  )

  // Org field view for the context being edited (drives save-vs-create)
  const orgFieldView = useOrgFieldView(entityDefinitionId, draftContextType)

  // Store actions
  const addView = useDynamicTableStore((s) => s.addView)
  const setViewStoreInitialized = useDynamicTableStore((s) => s.setInitialized)
  const apiUtils = api.useUtils()

  // Mutations for persisting the draft on save
  const updateView = api.tableView.update.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to save view', description: error.message })
    },
  })
  const createView = api.tableView.create.useMutation({
    onSuccess: (newView) => {
      addView(newView)
    },
    onError: async (error) => {
      // A default view for this context usually already exists server-side but
      // this tab's store is stale (e.g. views seeded by a migration after the
      // store hydrated) — the insert trips the one-default-per-context unique
      // index. Rehydrate so the next save finds the view and updates it.
      await apiUtils.tableView.listAll.invalidate()
      setViewStoreInitialized(false)
      toastError({
        title: 'Failed to create view',
        description: `${error.message}. Views have been refreshed — please try again.`,
      })
    },
  })

  /** Snapshot a FieldViewConfig for the given context type from the store */
  const snapshotConfigForContext = useCallback(
    (ct: ViewContextType): FieldViewConfig => {
      const state = useDynamicTableStore.getState()
      const views = state.viewsByTableId[entityDefinitionId] ?? []
      const view = views.find((v) => v.contextType === ct && v.isDefault && v.isShared)
      // `TableView.config` is typed as the table `ViewConfig`, but panel/dialog
      // views store a `FieldViewConfig` in the same column (the router's input
      // accepts either) — hence the widening hop. See the burndown referral on
      // `TableView.config`.
      const storedConfig = view?.config as unknown as FieldViewConfig | undefined
      const baseConfig = storedConfig ?? createDefaultFieldViewConfig(fieldIds)

      // Ensure all current field IDs are represented (handles newly added fields).
      // Backfill visibility from the computed default for the context — blanket
      // `true` would resurrect fields the dialog default-hidden rule suppresses
      // (inverses, showInDialogs:false, identity fields) on every view save.
      // `resolveFieldVisible` is that same rule plus the panel's `showInPanel`
      // default, so the panel surface gets the equivalent protection.
      const fieldById = new Map(fields.map((f) => [String(f.resourceFieldId ?? f.id ?? f.key), f]))
      const existingOrderSet = new Set(baseConfig.fieldOrder)
      const missingFields = fieldIds.filter((id) => !existingOrderSet.has(id))

      // Order must be merged with the SAME anchor rule the read path uses
      // (`useFieldView`), not appended. Appending would show a newly added field
      // at the bottom the moment draft mode opens — below the trailing metadata
      // block — and saving from that state would persist the wrong position,
      // reintroducing on the write path exactly what the merge fixes on read.
      const groups = baseConfig.fieldGroups ?? []
      const groupedFieldIds = new Set(groups.flatMap((group) => group.fieldIds))
      const mergedOrder = mergeFieldOrder({
        baseline: fieldIds,
        storedOrder: baseConfig.fieldOrder,
        isTrailing: (id) => {
          const field = fieldById.get(id)
          return field ? isTrailingMetadataField(field) : false
        },
        // A new field must never anchor on a grouped one: it is in no group's
        // `fieldIds`, so splicing it inside a group's block would render it
        // among that group's fields while not being a member — exactly the
        // contiguity break that makes drop-position-to-membership ill-defined.
        isGrouped: (id) => groupedFieldIds.has(id),
      })

      return {
        ...baseConfig,
        fieldGroups: groups,
        // A stored order written before groups existed (or edited by an older
        // client) is not group-contiguous; normalize on the way out so the draft
        // starts from the invariant every mutator below maintains.
        fieldOrder: normalizeGroupContiguity(mergedOrder, groups),
        fieldVisibility: {
          ...baseConfig.fieldVisibility,
          ...Object.fromEntries(
            missingFields.map((id) => {
              const field = fieldById.get(id)
              return [id, field ? resolveFieldVisible(field, ct, baseConfig.fieldVisibility) : true]
            })
          ),
        },
      }
    },
    [entityDefinitionId, fieldIds, fields]
  )

  /** Enter draft mode: snapshot the current config into the buffer */
  const enterDraft = useCallback(() => {
    const snapshot = snapshotConfigForContext(contextType)
    setDraftContextType(contextType)
    setDraft(snapshot)
    setPristineConfig(JSON.stringify(snapshot))
    setIsDraftMode(true)
  }, [contextType, snapshotConfigForContext])

  /** Cancel draft mode: discard the buffer, exit */
  const cancelDraft = useCallback(() => {
    setDraft(null)
    setPristineConfig(null)
    setIsDraftMode(false)
  }, [])

  /**
   * Switch which context is being edited, re-snapshotting from the store.
   *
   * The new snapshot becomes the dirty baseline — unsaved edits to the previous
   * context are dropped by the re-snapshot itself, so carrying its baseline over
   * would only report a phantom diff against a draft that no longer exists.
   */
  const switchDraftContext = useCallback(
    (newContextType: ViewContextType) => {
      const snapshot = snapshotConfigForContext(newContextType)
      setDraftContextType(newContextType)
      setDraft(snapshot)
      setPristineConfig(JSON.stringify(snapshot))
    },
    [snapshotConfigForContext]
  )

  /**
   * Structural comparison against the opening snapshot.
   *
   * `JSON.stringify` is sound here because every mutator above rebuilds the
   * config by spreading the previous one and overwriting keys that the snapshot
   * already established, so key order never drifts. The only way it can be wrong
   * is a spurious `true` (a prompt with nothing to save) — never a false `false`,
   * which is the direction that would silently discard the user's work.
   */
  const isDraftDirty = useMemo(
    () => draft !== null && pristineConfig !== null && JSON.stringify(draft) !== pristineConfig,
    [draft, pristineConfig]
  )

  /** Toggle field visibility in the draft (no server call) */
  const setDraftVisibility = useCallback((resourceFieldId: string, visible: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        fieldVisibility: { ...prev.fieldVisibility, [resourceFieldId]: visible },
      }
    })
  }, [])

  /** Reorder a field within the draft's `fieldOrder` (no server call) */
  const reorderDraft = useCallback(
    (activeId: string, overId: string, edge?: 'before' | 'after') => {
      if (activeId === overId) return

      setDraft((prev) => {
        if (!prev) return prev
        const newOrder = moveFieldToSlot({
          fieldOrder: prev.fieldOrder,
          fieldId: activeId,
          overId,
          edge,
        })
        // Returned by reference when either id is missing or the move is a no-op.
        if (newOrder === prev.fieldOrder) return prev

        // A drag can drop a non-member in the middle of a group's block, which
        // would split it. Membership changes travel through `assignFieldToGroup`;
        // position alone never rewrites it, so the split is repaired here instead.
        return { ...prev, fieldOrder: normalizeGroupContiguity(newOrder, prev.fieldGroups ?? []) }
      })
    },
    []
  )

  /** Add a group to the draft. Returns the new group's id so the caller can focus/rename it. */
  const addGroup = useCallback((label: string): string => {
    const id = generateId('fg')
    setDraft((prev) => {
      if (!prev) return prev
      return { ...prev, fieldGroups: [...(prev.fieldGroups ?? []), { id, label, fieldIds: [] }] }
    })
    // A brand-new group has no members, so `fieldOrder` cannot have become
    // non-contiguous — nothing to normalize.
    return id
  }, [])

  /** Rename a group in the draft (no server call) */
  const renameGroup = useCallback((groupId: string, label: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      const groups = prev.fieldGroups ?? []
      return { ...prev, fieldGroups: groups.map((g) => (g.id === groupId ? { ...g, label } : g)) }
    })
  }, [])

  /**
   * Delete a group. Its members become ungrouped purely by the group row
   * disappearing — membership is explicit, so `fieldOrder` is never touched to
   * achieve that, and no field is ever removed from the view.
   */
  const deleteGroup = useCallback((groupId: string) => {
    setDraft((prev) => {
      if (!prev) return prev
      const groups = (prev.fieldGroups ?? []).filter((g) => g.id !== groupId)
      return {
        ...prev,
        fieldGroups: groups,
        fieldOrder: normalizeGroupContiguity(prev.fieldOrder, groups),
      }
    })
  }, [])

  /** Collapse/expand a group in the draft (persisted org-wide on save) */
  const setGroupCollapsed = useCallback((groupId: string, collapsed: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev
      const groups = prev.fieldGroups ?? []
      return {
        ...prev,
        fieldGroups: groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
      }
    })
  }, [])

  /**
   * Move a field into a group, or out of every group with `null`.
   *
   * Membership and position are separate stores, so the reassignment is followed
   * by a contiguity pass that pulls the field into (or out of) its group's block.
   */
  const assignFieldToGroup = useCallback((fieldId: string, groupId: string | null) => {
    setDraft((prev) => {
      if (!prev) return prev
      // `assignFieldToGroupInOrder` moves membership AND position together: a
      // field joining from above the block must not become the block's anchor
      // and drag the whole group up with it. See that function's doc.
      const { fieldOrder, groups } = assignFieldToGroupInOrder({
        fieldOrder: prev.fieldOrder,
        groups: prev.fieldGroups ?? [],
        fieldId,
        groupId,
      })
      return { ...prev, fieldGroups: groups, fieldOrder }
    })
  }, [])

  /**
   * Move a whole group to `overId`'s position, carrying its members with it.
   *
   * Two different writes, because a group's position has two different sources:
   *
   * - **Populated** → `fieldOrder`. Membership is untouched (a block move is
   *   purely positional), and `moveGroupBlock` owns all of the arithmetic —
   *   block extraction, drop-index resolution, the snap-to-group-boundary rule —
   *   returning an already-normalized order, so there is no second contiguity
   *   pass here.
   * - **Empty** → the group's own `anchorFieldId`. There are no member rows to
   *   lift, so `moveGroupBlock` can only no-op; the group instead records the
   *   field it renders before. The anchor stays on the row once members arrive
   *   and is simply ignored — a populated group derives its position from its
   *   first member — so emptying the group later returns it to where it was.
   */
  const moveGroup = useCallback((groupId: string, overId: string, overIsGroup: boolean) => {
    if (groupId === overId) return

    setDraft((prev) => {
      if (!prev) return prev
      const groups = prev.fieldGroups ?? []
      const moving = groups.find((group) => group.id === groupId)
      if (!moving) return prev

      const hasMembers = moving.fieldIds.some((fieldId) => prev.fieldOrder.includes(fieldId))
      if (!hasMembers) {
        const resolved = resolveEmptyGroupAnchor({
          fieldOrder: prev.fieldOrder,
          groups,
          groupId,
          overId,
          overIsGroup,
        })
        if (!resolved) return prev
        return {
          ...prev,
          fieldGroups: groups.map((group) =>
            group.id === groupId ? { ...group, anchorFieldId: resolved.anchorFieldId } : group
          ),
        }
      }

      return {
        ...prev,
        fieldOrder: moveGroupBlock({
          fieldOrder: prev.fieldOrder,
          groups,
          groupId,
          overId,
          overIsGroup,
        }),
      }
    })
  }, [])

  /**
   * Persist the draft: update the org default view for the edited context, or
   * create it when none exists. Exits draft mode on success. Never rejects —
   * failures surface through the mutations' `onError` toasts and leave the
   * draft intact so the user can retry.
   */
  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!draft) return false

    try {
      if (orgFieldView) {
        // Update existing view
        await updateView.mutateAsync({
          id: orgFieldView.id,
          config: draft,
        })
        // Update the view config in the store (immer allows direct mutation)
        useDynamicTableStore.setState((state) => {
          const views = state.viewsByTableId[entityDefinitionId]
          if (!views) return
          const view = views.find((v) => v.id === orgFieldView.id)
          // Panel/dialog views persist a `FieldViewConfig` in the same `config`
          // column that table views use for `ViewConfig` (the router accepts
          // either), but `TableView.config` only models the table shape — hence
          // the widening hop. See the burndown referral on `TableView.config`.
          if (view) view.config = draft as unknown as typeof view.config
        })
      } else {
        // Create new view (addView called via onSuccess)
        await createView.mutateAsync({
          tableId: entityDefinitionId,
          name: defaultViewNameForContext(draftContextType),
          contextType: draftContextType,
          isShared: true,
          isDefault: true,
          config: draft,
        })
      }

      // Exit draft mode
      setDraft(null)
      setPristineConfig(null)
      setIsDraftMode(false)
      return true
    } catch {
      // Errors handled by mutation onError
      return false
    }
  }, [draft, orgFieldView, draftContextType, entityDefinitionId, updateView, createView])

  return {
    draft,
    isDraftMode,
    isDraftDirty,
    isSaving: updateView.isPending || createView.isPending,
    draftContextType,
    enterDraft,
    cancelDraft,
    switchDraftContext,
    setDraftVisibility,
    reorderDraft,
    saveDraft,
    // `saveDraft` writes the whole config object, so `fieldGroups` persists with
    // the same single write as order and visibility — there is no second call.
    draftGroups: draft?.fieldGroups ?? NO_GROUPS,
    addGroup,
    renameGroup,
    deleteGroup,
    setGroupCollapsed,
    assignFieldToGroup,
    moveGroup,
  }
}
