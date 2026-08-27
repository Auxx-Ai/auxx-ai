// apps/web/src/components/records/records-view.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { isAiEligible } from '@auxx/lib/custom-fields/client'
import { converters } from '@auxx/lib/field-values/client'
import { canEditRecordAtRung, FeatureKey } from '@auxx/lib/permissions/client'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import { type AiOptions, getRelatedEntityDefinitionId } from '@auxx/types/custom-field'
import { keyToFieldRef, toFieldId, toResourceFieldId } from '@auxx/types/field'
import type { TypedFieldValue } from '@auxx/types/field-value'
import { Button } from '@auxx/ui/components/button'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { MainPageAction } from '@auxx/ui/components/main-page'
import { useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Combine,
  Database,
  Play,
  Plus,
  Printer,
  Send,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BulkUpdateEntityInstanceDialog } from '~/components/custom-fields/ui/bulk-update-entity-instance-dialog'
import { ExportProgressDialog } from '~/components/data-export/ui/export-progress-dialog'
import type { CellSelectionConfig } from '~/components/dynamic-table'
import { PrimaryFieldCell } from '~/components/dynamic-table'
import {
  DynamicResourceView,
  type DynamicResourceViewHandle,
} from '~/components/dynamic-table/dynamic-resource-view'
import { useTableViewRealtime } from '~/components/dynamic-table/hooks/use-table-view-realtime'
import { optionLabel } from '~/components/dynamic-table/utils/cell-coercion'
import { resolveColumnField } from '~/components/dynamic-table/utils/column-id'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { EmptyState } from '~/components/global/empty-state'
import { MainPageLoading, MainPageNotFound } from '~/components/global/main-page-states'
import { getCreateHotkey } from '~/components/global-create/system-hotkeys'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { KopilotContext } from '~/components/kopilot/context'
import { MergeDialog } from '~/components/merge'
import { PrintWizardDialog } from '~/components/print/ui/print-wizard-dialog'
import { RecordActionsMenu } from '~/components/records/record-actions-menu'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import {
  getRecordStoreState,
  type RecordMeta,
  toRecordId,
  useResource,
} from '~/components/resources'
import { useRunAiBulkGenerate } from '~/components/resources/hooks/run-ai-bulk-generate'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useActorStore } from '~/components/resources/store/actor-store'
import { useRelationshipStore } from '~/components/resources/store/relationship-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { AddToSequenceDialog } from '~/components/sequences/ui/add-to-sequence-dialog'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'
import { useAccess } from '~/providers/capabilities-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { RecordDrawer } from './record-drawer'
import { splitRecordSearch, useRecordsSearchStore } from './records-search-store'
import { RecordsSearchBar } from './records-searchbar'

/**
 * Entity row type extending RecordMeta for type alignment with useRecordList
 */
export interface EntityRow extends RecordMeta {
  entityDefinitionId: string
  archivedAt: string | null
}

/**
 * Props for RecordsView component
 */
interface RecordsViewProps {
  /** Resource slug to load (e.g. 'contacts', 'orders') */
  slug: string
  /** Base URL path for breadcrumbs and import links. Defaults to /app/custom/${slug} */
  basePath?: string
  /** Extra actions rendered in the header action slot, next to the Create button (e.g. the
   * invoices/work-orders "Batch invoice" entry point, plan
   * plans/dispatch/37a-batch-advance-invoicing.md §3 decision #4). */
  pageActions?: ReactNode
}

/**
 * RecordsView component
 * Composes DynamicResourceView with the records-specific primary cell,
 * bulk-action set, paste/fill/AI cell selection config, and dialogs. Renders
 * only `MainPageContent` + contributions (`MainPageAction` for Create) — the
 * calling route (`EntityRouteLayout`) owns `MainPage`/`MainPageHeader`.
 */
export function RecordsView({ slug, basePath, pageActions }: RecordsViewProps) {
  const resolvedBasePath = basePath ?? `/app/custom/${slug}`
  const router = useRouter()
  const { hasAccess } = useFeatureFlags()
  const sequencesEnabled = hasAccess(FeatureKey.sequences)

  // Cross-client saved-view refresh (e.g. Kopilot create/update/set-default).
  useTableViewRealtime()

  // Resource is needed in this scope for header/breadcrumb labels and to
  // build the cellSelection config. DynamicResourceView resolves its own
  // copy from the same store — both share the same subscription.
  const { resource, isLoading } = useResource(slug)
  const entityDefinitionId = resource?.id
  const createHotkey = getCreateHotkey(resource?.apiSlug)

  // NAMED IMPORTERS — extra Import entries this resource hosts for its hidden
  // satellites. `part` declares "Import supplier prices" on `part.vendorParts`,
  // because `vendor_part` is invisible and so has no records page of its own to
  // put an Import button on. Empty for every resource that declares none, which is
  // all but one today.
  //
  // 🛑 The link carries the DECLARING FIELD's key, never the target def id. This
  // resource is org-MERGED, so its relations' `inverseResourceFieldId` holds the
  // org's EntityDefinition CUID, while the server validates against the static
  // registry, where the same relation reads `vendor_part:part`. Sending the def id
  // meant the server matched nothing and silently fell back to the host's own
  // importer: the menu item opened the WRONG wizard. A field key is the same string
  // on both sides.
  const namedImporters = useMemo(
    () =>
      (resource?.fields ?? []).flatMap((field) =>
        field.namedImporter
          ? [{ label: field.namedImporter.label, target: field.systemAttribute ?? field.key }]
          : []
      ),
    [resource?.fields]
  )

  // Per-def write gate (Layer 2 × Layer 3) — the single `edit`-floor predicate
  // that governs every record write on this def (create/update/delete/archive/
  // merge all sit at the same floor, §0.1). Hides those affordances for a member
  // who can view but not edit this def (Read-only grantee / field seat). The
  // server enforces regardless; this just avoids a click-then-403. Keyed by
  // `entityDefinitionId` (the defAccess keyspace), not `resource.id`.
  const { canEditEntity, canAdministerDef, recordDefRung, hasRecordGrantsOn } = useAccess()
  const canEdit = resource ? canEditEntity(resource.entityDefinitionId) : false
  /**
   * Whether ANY row of this def may be more permissive than the def level —
   * i.e. the member holds ≥1 per-record grant here.
   *
   * 🔴 **This is what stops the def-level `readOnly` degrade from hard-blocking a
   * per-record `edit` grant.** `cellSelectionConfig.readOnly` is checked FIRST at
   * every write entry point and `isRowReadOnly` can only ever NARROW it further
   * (`selectable-table-cell.tsx`), so `readOnly: !canEdit` made a row shared at
   * `edit` uneditable inside a def the member cannot otherwise edit — exactly the
   * case §6.2 exists to serve, and the symptom that outlived the SQL fix.
   */
  const hasRowGrants = resource ? hasRecordGrantsOn(resource.entityDefinitionId) : false
  // The DEF rung — the fallback for a row that carries no `_access` stamp yet.
  // It is exactly what the server's fold computes for a row with no grants on
  // it, so the fallback is the honest one rather than a guess.
  const defRung = resource ? recordDefRung(resource.entityDefinitionId) : undefined
  /**
   * The per-ROW affordance rung used to live here as `rowRung`, feeding a
   * hand-rolled kebab menu. Both are gone: the row renders `RecordActionsMenu`,
   * which resolves the same stamp through `useRecordAccess` — the ONE per-row
   * gate the page and the drawer already shared.
   *
   * What stays is the fold from a bare row id, because the inline cell editors
   * have no `RecordActionsMenu` to ask.
   */
  const isRowReadOnly = useCallback(
    (rowId: string) => {
      if (!entityDefinitionId) return true
      const stamp = getRecordStoreState().records[entityDefinitionId]?.get(rowId)?._access
      return !canEditRecordAtRung(stamp ?? defRung ?? 'none')
    },
    [entityDefinitionId, defRung]
  )
  // Per-def ADMINISTRATION gate (the `Full`/`admin` rung) — managing the def's
  // FIELDS is def administration, not a record write. Hides the "Create field"
  // command-palette action for non-def-admins; the server (`customField.create`)
  // enforces regardless (#1303). Keyed by `entityDefinitionId`, like `canEdit`.
  const canAdminister = resource ? canAdministerDef(resource.entityDefinitionId) : false

  // Imperative handle into DynamicResourceView for refresh + field-value reads
  // (paste/fill needs getValue from the inner syncer).
  const viewRef = useRef<DynamicResourceViewHandle | null>(null)

  // Create dialog state — synced with ?create URL param for external triggers (e.g. layout header button)
  const [createParam, setCreateParam] = useQueryState('create', parseAsBoolean.withDefault(false))
  const [isCreateDialogOpenInternal, setIsCreateDialogOpenInternal] = useState(false)
  const isCreateDialogOpen = isCreateDialogOpenInternal || createParam
  const setIsCreateDialogOpen = useCallback(
    (open: boolean) => {
      setIsCreateDialogOpenInternal(open)
      if (!open && createParam) setCreateParam(null)
    },
    [createParam, setCreateParam]
  )

  // Local state
  const [editingInstance, setEditingInstance] = useState<EntityRow | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

  // Preset field values for the create dialog — set by the calendar view's
  // click-empty-day-to-create (plan §3.3, `onAddNew(presetValues)`).
  const [createPresetValues, setCreatePresetValues] = useState<Record<string, unknown> | undefined>(
    undefined
  )
  const queryClient = useQueryClient()

  // Drawer state - synced to URL via ?id= param
  const [selectedInstanceId, setSelectedInstanceId] = useQueryState(
    'id',
    parseAsString.withDefault('')
  )
  const isDrawerOpen = !!selectedInstanceId

  // Kanban card selection state (lives here to persist across drawer open/close)
  const [selectedKanbanCardIds, setSelectedKanbanCardIds] = useState<Set<string>>(new Set())

  // Dialog state
  const [isBulkUpdateDialogOpen, setIsBulkUpdateDialogOpen] = useState(false)
  const [isWorkflowDialogOpen, setIsWorkflowDialogOpen] = useState(false)
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false)
  const [isAddToSequenceDialogOpen, setIsAddToSequenceDialogOpen] = useState(false)
  // No hoisted per-row share dialog any more: `RecordActionsMenu` owns the one
  // it opens, which is the whole reason `PrimaryCell` had to learn to take a
  // complete menu instead of items (its dialogs must outlive the closing menu).

  // Print wizard (bulk-action entry — scope pinned to the frozen selection) + its progress
  // dialog, wired exactly like the CSV export flow (`table-toolbar.tsx`'s toolbar entry).
  const [printSelection, setPrintSelection] = useState<{ recordIds: RecordId[] } | null>(null)
  const [isPrintWizardOpen, setIsPrintWizardOpen] = useState(false)
  const [printJobId, setPrintJobId] = useState<string | null>(null)
  const [printProgressOpen, setPrintProgressOpen] = useState(false)

  // Search bar conditions are records-specific (one global store).
  // DynamicResourceView can't import this store, so we hand it the two axes
  // separately: the narrowing conditions as a baselineFilter, and the typed free
  // text as `search`. Splitting them here is plan decision 0.3 — merged, the
  // typed text compiled to `displayName ILIKE '%q%'`; split, it reaches the
  // ranked tsvector + trigram predicate.
  const searchConditions = useRecordsSearchStore((s) => s.conditions)
  const { search, group: searchGroup } = useMemo(
    () => splitRecordSearch(searchConditions),
    [searchConditions]
  )

  const fieldMap = useResourceStore((state) => state.fieldMap)

  // Stable callbacks shared with the operations hook
  const handleOperationsDrawerClose = useCallback(() => {
    setSelectedInstanceId(null)
  }, [setSelectedInstanceId])

  const handleOperationsClearSelection = useCallback(() => {
    setSelectedRowIds(new Set())
  }, [])

  const refresh = useCallback(() => {
    viewRef.current?.refresh()
  }, [])

  // Deleted/archived rows are gone — drop them from the table's selection so the
  // bulk action bar stops counting them. Note this is the dynamic-table selection
  // store, which `handleOperationsClearSelection` above does NOT touch: that one
  // clears the frozen selection this view pins dialog scope to.
  const handleRowsRemoved = useCallback((rowIds: string[]) => {
    viewRef.current?.deselect(rowIds)
  }, [])

  const {
    handleDrawerDelete,
    handleBulkDelete,
    handleBulkArchive,
    ConfirmDeleteDialog,
    ConfirmArchiveDialog,
  } = useEntityInstanceOperations({
    entityDefinitionId,
    resourceLabel: resource?.label,
    resourcePlural: resource?.plural,
    onDrawerClose: handleOperationsDrawerClose,
    onClearSelection: handleOperationsClearSelection,
    onRowsRemoved: handleRowsRemoved,
    onRefetch: refresh,
  })

  const handleOpenDrawer = useCallback(
    (row: EntityRow) => {
      setSelectedInstanceId(row.id)
    },
    [setSelectedInstanceId]
  )

  const handleOpenEditDialog = useCallback(
    (row: EntityRow) => {
      setEditingInstance(row)
      setCreatePresetValues(undefined)
      setIsCreateDialogOpen(true)
    },
    [setIsCreateDialogOpen]
  )

  const handleDrawerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setSelectedInstanceId(null)
    },
    [setSelectedInstanceId]
  )

  const handleRowSelectionChange = useCallback((selectedRows: Set<string>) => {
    setSelectedRowIds(selectedRows)
  }, [])

  const handleDialogSaved = useCallback(
    (instanceId?: string) => {
      // CREATE only — an edit already has your attention on the row you edited.
      // `editingInstance` is the create/update discriminator the dialog already
      // uses, so nothing new has to be tracked. `instanceId` is absent when the
      // form is staying open for another entry ("create more"), which is an
      // explicit batch-entry mode and must not pop a drawer per save.
      const wasCreate = !editingInstance
      setEditingInstance(null)
      setCreatePresetValues(undefined)
      refresh()
      // The calendar view's id list is a standalone `useQuery` keyed
      // `['calendar-record-ids', ...]` (not a tRPC `record.listFiltered` query),
      // so it's outside the generic `record:created` realtime handler's
      // `utils.record.listFiltered.invalidate` reach — invalidate it explicitly
      // so a record created via the click-empty-day-to-create dialog shows up on
      // the calendar without waiting out the query's 30s staleTime.
      queryClient.invalidateQueries({ queryKey: ['calendar-record-ids'] })

      if (!wasCreate || !instanceId) return

      // The row's DATA is already seeded (record + field-value stores), so the
      // drawer paints from cache while `refresh()` re-queries list membership in
      // the background — no waterfall, and no dependence on the record passing
      // the current filter or landing on a loaded page.
      setSelectedInstanceId(instanceId)
      // Tell the view a record was created here, so it can say so if the list
      // comes back without it. Membership is the server's answer, not ours.
      viewRef.current?.noteCreated(instanceId)
    },
    [editingInstance, refresh, queryClient, setSelectedInstanceId]
  )

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsCreateDialogOpen(open)
      if (!open) {
        setEditingInstance(null)
        setCreatePresetValues(undefined)
      }
    },
    [setIsCreateDialogOpen]
  )

  /**
   * The menu's record TYPE key, derived exactly as `RecordDrawer` derives it —
   * both surfaces must resolve the same `RECORD_ACTIONS_REGISTRY` entry or the
   * row and the drawer start disagreeing about what a record offers again, which
   * is the drift PR #1438 existed to end.
   */
  const menuEntityType = useMemo(
    () => resource?.entityType ?? (resource?.type === 'system' ? resource?.id : 'custom'),
    [resource?.entityType, resource?.type, resource?.id]
  )

  // Primary cell renderer — title + the SHARED record-actions menu.
  const primaryFieldId = resource?.display.primaryDisplayField?.id ?? resource?.fields[0]?.id
  const primaryResourceFieldId = useMemo(() => {
    if (!entityDefinitionId || !primaryFieldId) return null
    return toResourceFieldId(entityDefinitionId, toFieldId(primaryFieldId))
  }, [entityDefinitionId, primaryFieldId])

  const primaryCellRender = useCallback(
    (row: EntityRow) => {
      if (!entityDefinitionId || !primaryResourceFieldId) return null
      return (
        <PrimaryFieldCell
          resourceFieldId={primaryResourceFieldId}
          rowId={row.id}
          onTitleClick={() => handleOpenDrawer(row)}
          // The LAST of the three record surfaces to join the shared menu
          // (HANDOFF §1, "Still owed"). It hand-rolled its own list against its
          // own helpers until `PrimaryCell` learned to take a whole menu — the
          // menu's dialogs must be siblings of its `DropdownMenu`, which
          // items-as-`children` could not express.
          actions={
            <RecordActionsMenu
              recordId={toRecordId(entityDefinitionId, row.id)}
              entityType={menuEntityType ?? ''}
              record={row}
              surface='row'
              onEdit={() => handleOpenEditDialog(row)}
              // Archive and Delete live inside the menu now, and its own
              // `useEntityInstanceOperations` only refetches through this
              // callback — without it the deleted row stays on screen.
              onDeleted={refresh}>
              {/* Favourite stays an ITEM here, unlike the page and the drawer,
                  which promote it to a star beside the trigger. A table row has
                  nowhere to put a persistent control, and a star that appears
                  only on hover reports its state to nobody. */}
              <FavoriteToggleMenuItem
                targetType='ENTITY_INSTANCE'
                targetIds={{ entityDefinitionId, entityInstanceId: row.id }}
              />
            </RecordActionsMenu>
          }
        />
      )
    },
    [
      entityDefinitionId,
      primaryResourceFieldId,
      menuEntityType,
      handleOpenDrawer,
      handleOpenEditDialog,
      refresh,
    ]
  )

  // Contact-only bulk action gate — no other bulk action is entity-gated yet,
  // so this mirrors the established `resource?.entityType === '<type>'`
  // convention (record-editor-dialog custom editors, detail-view back-URLs).
  const isContactResource = resource?.entityType === 'contact'

  const bulkActions = useMemo(
    () => [
      {
        label: 'Run workflow',
        icon: Play,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          setSelectedRowIds(new Set(rows.map((r) => r.id)))
          setIsWorkflowDialogOpen(true)
        },
      },
      // Merge is a record write (edit floor) — only for editable defs.
      ...(canEdit
        ? [
            {
              label: 'Merge',
              icon: Combine,
              variant: 'outline' as const,
              action: (rows: EntityRow[]) => {
                setSelectedRowIds(new Set(rows.map((r) => r.id)))
                setIsMergeDialogOpen(true)
              },
            },
          ]
        : []),
      // Sequences plan §17 — contacts are the only enrollable recipient type.
      ...(isContactResource && sequencesEnabled
        ? [
            {
              label: 'Add to sequence',
              icon: Send,
              variant: 'outline' as const,
              action: (rows: EntityRow[]) => {
                setSelectedRowIds(new Set(rows.map((r) => r.id)))
                setIsAddToSequenceDialogOpen(true)
              },
            },
          ]
        : []),
      // Bulk edit / archive / delete — record writes, gated on the edit floor.
      ...(canEdit
        ? [
            {
              label: 'Edit',
              icon: SquarePen,
              variant: 'outline' as const,
              action: (rows: EntityRow[]) => {
                setSelectedRowIds(new Set(rows.map((r) => r.id)))
                setIsBulkUpdateDialogOpen(true)
              },
            },
          ]
        : []),
      {
        label: 'Print…',
        icon: Printer,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          if (!entityDefinitionId) return
          setPrintSelection({
            recordIds: rows.map((r) => toRecordId(entityDefinitionId, r.id)),
          })
          setIsPrintWizardOpen(true)
        },
      },
      ...(canEdit
        ? [
            {
              label: 'Archive',
              icon: Archive,
              variant: 'outline' as const,
              action: (rows: EntityRow[]) => handleBulkArchive(rows),
            },
            {
              label: 'Delete',
              icon: Trash2,
              variant: 'destructive' as const,
              action: (rows: EntityRow[]) => handleBulkDelete(rows),
            },
          ]
        : []),
    ],
    [
      canEdit,
      handleBulkArchive,
      handleBulkDelete,
      isContactResource,
      sequencesEnabled,
      entityDefinitionId,
    ]
  )

  const { saveBulkMultipleFields } = useSaveFieldValue()
  const runAiBulkGenerate = useRunAiBulkGenerate()

  /**
   * Cell selection configuration for inline editing.
   * `getValue` is sourced from the inner syncer via `viewRef.current.getValue`;
   * it's read at call-time so a null ref during first render is safe.
   */
  const cellSelectionConfig: CellSelectionConfig = useMemo(() => {
    // A columnId IS a `fieldRefToKey` encoding, so it decodes straight back to
    // the FieldReference `getValue` expects. Every value the field-value store
    // holds was written through `formatToTypedInput`, so it is a
    // TypedFieldValue by construction — the store just types it as `unknown`.
    const readValue = (recordId: RecordId, columnId: string) =>
      viewRef.current?.getValue(recordId, keyToFieldRef(columnId)) as
        | TypedFieldValue
        | TypedFieldValue[]
        | null
        | undefined

    // Path columns come back non-updatable — see `resolveColumnField`.
    const resolveField = (columnId: string): ResourceField | null =>
      resolveColumnField(fieldMap, columnId)

    return {
      enabled: true,
      // Read-only degrade for members below Edit on this def — keeps selection +
      // copy, disables every inline write path (server enforces regardless).
      //
      // ⚠ `&& !hasRowGrants`: this flag is the SHORT-CIRCUIT, checked before
      // `isRowReadOnly` at every write entry point, and `isRowReadOnly` can only
      // narrow it. So it may only assert "no row here is editable" — which stops
      // being true the moment the member holds one per-record grant. Below Edit
      // on the def AND holding no row grants, nothing changes; holding a grant,
      // the per-row predicate takes over and answers the same question the def
      // flag was answering, only correctly.
      readOnly: !canEdit && !hasRowGrants,
      // …narrowed PER ROW by the `_access` stamp (§6.2). This is what makes a
      // shared-at-`edit` row writable inside a def the member cannot otherwise
      // edit — and what keeps every OTHER row of that def read-only.
      isRowReadOnly,
      getFieldDefinition: resolveField,
      getCellValue: (rowId: string, columnId: string) => {
        if (columnId.startsWith('_')) return undefined
        if (!entityDefinitionId) return undefined
        return readValue(toRecordId(entityDefinitionId, rowId), columnId)
      },
      getRecordId: (rowId: string) => {
        if (!entityDefinitionId) return null as unknown as RecordId
        return toRecordId(entityDefinitionId, rowId)
      },
      formatCellForCopy: (rowId, columnId) => {
        if (!entityDefinitionId) return null
        if (columnId.startsWith('_')) return null
        const field = resolveField(columnId)
        if (!field) return null
        const fieldType = field.fieldType as FieldType | undefined
        if (!fieldType) return null

        const raw = readValue(toRecordId(entityDefinitionId, rowId), columnId)
        if (raw === null || raw === undefined) {
          return { display: '', fieldType }
        }

        const converter = converters[fieldType]
        if (!converter) return { display: String(raw ?? ''), fieldType }

        // Relationship: display is the linked record's primary display.
        if (fieldType === 'RELATIONSHIP') {
          const dataMap = useRelationshipStore.getState().dataMap
          const resolve = (v: unknown): { recordId: string | null; display: string } => {
            const rid = converter.toRawValue(v) as string | null
            if (!rid) return { recordId: null, display: '' }
            const item = dataMap[rid as RecordId]
            return { recordId: rid, display: item?.displayName ?? rid }
          }
          if (Array.isArray(raw)) {
            const resolved = raw.map(resolve).filter((r) => r.recordId !== null)
            const recordIds = resolved.map((r) => r.recordId as string)
            const displays = resolved.map((r) => r.display)
            const joined = displays.join(', ')
            return {
              display: joined,
              raw: recordIds,
              fieldType,
              primaryDisplay: joined,
            }
          }
          const { recordId, display } = resolve(raw)
          if (!recordId) return { display: '', fieldType }
          return {
            display,
            raw: recordId,
            fieldType,
            recordId,
            primaryDisplay: display,
          }
        }

        // Actor: display is the user/group name from the actor store.
        if (fieldType === 'ACTOR') {
          const actors = useActorStore.getState().actors
          const resolve = (v: unknown): { actorId: string | null; display: string } => {
            const rawOut = converter.toRawValue(v) as
              | { actorId?: string; id?: string }
              | string
              | null
            if (!rawOut) return { actorId: null, display: '' }
            const actorId =
              typeof rawOut === 'string' ? rawOut : (rawOut.actorId ?? rawOut.id ?? null)
            if (!actorId) return { actorId: null, display: '' }
            const actor = actors.get(actorId as ActorId)
            return { actorId, display: actor?.name ?? actorId }
          }
          if (Array.isArray(raw)) {
            const resolved = raw.map(resolve).filter((r) => r.actorId !== null)
            const actorIds = resolved.map((r) => r.actorId as string)
            const displays = resolved.map((r) => r.display)
            const joined = displays.join(', ')
            return {
              display: joined,
              raw: actorIds,
              fieldType,
              primaryDisplay: joined,
            }
          }
          const { actorId, display } = resolve(raw)
          if (!actorId) return { display: '', fieldType }
          return {
            display,
            raw: actorId,
            fieldType,
            primaryDisplay: display,
          }
        }

        // Select-ish: the stored typed value carries only `optionId`, and ids are
        // minted PER FIELD — two tag columns both offering "Red" hold different
        // ids, and no label is denormalized onto the value. Copy therefore emits
        // the LABEL, which is the only thing a paste into another select column
        // (or into Excel) can match on.
        if (fieldType === 'SINGLE_SELECT' || fieldType === 'MULTI_SELECT' || fieldType === 'TAGS') {
          const opts = field.options?.options
          const optionIds = (Array.isArray(raw) ? raw : [raw])
            .map((v) => converter.toRawValue(v) as string | null)
            .filter((v): v is string => Boolean(v))
          return {
            display: optionIds.map((id) => optionLabel(id, opts)).join(', '),
            // Scalar raw for SINGLE_SELECT, array for the multi types — that's
            // the shape `coerceForPaste`'s lossless same-field path expects.
            raw: fieldType === 'SINGLE_SELECT' ? (optionIds[0] ?? null) : optionIds,
            fieldType,
          }
        }

        if (Array.isArray(raw)) {
          const displays = raw
            .map((v) => String(converter.toDisplayValue(v, field.options) ?? ''))
            .filter(Boolean)
          const rawValues = raw
            .map((v) => converter.toRawValue(v))
            .filter((v) => v !== null && v !== undefined)
          return {
            display: displays.join(', '),
            raw: rawValues,
            fieldType,
          }
        }
        const display = String(converter.toDisplayValue(raw, field.options) ?? '')
        return {
          display,
          raw: converter.toRawValue(raw),
          fieldType,
        }
      },
      resolveRelationshipByDisplay: (columnId, query) => {
        const field = resolveField(columnId)
        if (!field) return null
        const relationship = field.options?.relationship
        const targetDefId = relationship ? getRelatedEntityDefinitionId(relationship) : null
        if (!targetDefId) return null
        const q = query.trim().toLowerCase()
        if (!q) return null
        const dataMap = useRelationshipStore.getState().dataMap
        for (const [recordId, item] of Object.entries(dataMap)) {
          if (!item) continue
          if (!recordId.startsWith(`${targetDefId}:`)) continue
          if (item.displayName.toLowerCase() === q) return recordId
        }
        return null
      },
      resolveActorByDisplay: (columnId, query) => {
        const field = resolveField(columnId)
        if (!field) return null
        const target = field.options?.actor?.target ?? 'both'
        const q = query.trim().toLowerCase()
        if (!q) return null
        const actors = useActorStore.getState().actors
        for (const actor of actors.values()) {
          if (target === 'user' && actor.type !== 'user' && actor.type !== 'system') continue
          if (target === 'group' && actor.type !== 'group') continue
          if (actor.name.toLowerCase() === q) return actor.actorId
        }
        return null
      },
      clearCells: async (cells) => {
        if (!entityDefinitionId || cells.length === 0) return { skipped: 0 }

        const rowIds = new Set<string>()
        const fieldIds = new Set<string>()
        const fieldTypes = new Map<string, FieldType>()
        let skipped = 0

        for (const { rowId, columnId } of cells) {
          const field = resolveField(columnId)
          if (!field || field.capabilities?.updatable === false) {
            skipped++
            continue
          }
          // Per-ROW, because a range can span rows of mixed rungs once the def
          // flag stops short-circuiting. The server's per-row gate fails a batch
          // WHOLE, so an unfiltered range would lose the editable cells too.
          if (isRowReadOnly(rowId)) {
            skipped++
            continue
          }
          rowIds.add(rowId)
          fieldIds.add(columnId)
          if (!fieldTypes.has(columnId)) {
            fieldTypes.set(columnId, field.fieldType as FieldType)
          }
        }

        if (rowIds.size === 0 || fieldIds.size === 0) return { skipped }

        const recordIds = Array.from(rowIds).map((id) => toRecordId(entityDefinitionId, id))
        const fieldValues = Array.from(fieldIds).map((fieldId) => ({
          fieldId,
          value: null,
          fieldType: fieldTypes.get(fieldId) ?? ('TEXT' as FieldType),
        }))

        saveBulkMultipleFields(recordIds, fieldValues)
        return { skipped }
      },
      saveCells: async (updates) => {
        if (!entityDefinitionId || updates.length === 0) return { skipped: 0 }

        let skipped = 0
        const allowed: typeof updates = []
        for (const u of updates) {
          const field = resolveField(u.columnId)
          if (!field || field.capabilities?.updatable === false) {
            skipped++
            continue
          }
          // Per-ROW — see `clearCells` above for why the range must be filtered
          // here rather than left to the server.
          if (isRowReadOnly(u.rowId)) {
            skipped++
            continue
          }
          allowed.push(u)
        }
        if (allowed.length === 0) return { skipped }

        type Bucket = {
          recordIds: RecordId[]
          fieldValues: Array<{ fieldId: string; value: unknown; fieldType: FieldType }>
        }
        const buckets = new Map<string, Bucket>()
        const byRow = new Map<string, Array<{ columnId: string; value: unknown }>>()
        for (const u of allowed) {
          if (!byRow.has(u.rowId)) byRow.set(u.rowId, [])
          byRow.get(u.rowId)!.push({ columnId: u.columnId, value: u.value })
        }
        for (const [rowId, row] of byRow.entries()) {
          row.sort((a, b) => (a.columnId < b.columnId ? -1 : a.columnId > b.columnId ? 1 : 0))
          const sig = row.map((c) => `${c.columnId}|${JSON.stringify(c.value)}`).join('||')
          let bucket = buckets.get(sig)
          if (!bucket) {
            bucket = {
              recordIds: [],
              fieldValues: row.map((c) => ({
                fieldId: c.columnId,
                value: c.value,
                fieldType:
                  (resolveField(c.columnId)?.fieldType as FieldType) ?? ('TEXT' as FieldType),
              })),
            }
            buckets.set(sig, bucket)
          }
          bucket.recordIds.push(toRecordId(entityDefinitionId, rowId))
        }

        for (const bucket of buckets.values()) {
          saveBulkMultipleFields(bucket.recordIds, bucket.fieldValues)
        }
        return { skipped }
      },
      isAiField: (columnId) => {
        const field = resolveField(columnId)
        if (!field?.fieldType) return false
        if (!isAiEligible(field.fieldType)) return false
        const ai = (field.options as { ai?: AiOptions } | null | undefined)?.ai
        return ai?.enabled === true
      },
      saveAiCells: async (cells) => {
        if (!entityDefinitionId || cells.length === 0) return { skipped: 0 }

        let skipped = 0
        const byCol = new Map<string, string[]>()
        for (const { rowId, columnId } of cells) {
          const field = resolveField(columnId)
          if (!field || field.capabilities?.updatable === false || !field.fieldType) {
            skipped++
            continue
          }
          if (!isAiEligible(field.fieldType)) {
            skipped++
            continue
          }
          // Per-ROW — AI generation writes field values like any other save.
          if (isRowReadOnly(rowId)) {
            skipped++
            continue
          }
          if (!byCol.has(columnId)) byCol.set(columnId, [])
          byCol.get(columnId)!.push(rowId)
        }

        for (const [columnId, rowIds] of byCol.entries()) {
          const field = resolveField(columnId)
          if (!field?.fieldType) continue
          runAiBulkGenerate(
            rowIds,
            { id: field.id, fieldType: field.fieldType as FieldType },
            entityDefinitionId
          )
        }
        return { skipped }
      },
    }
  }, [
    entityDefinitionId,
    fieldMap,
    saveBulkMultipleFields,
    runAiBulkGenerate,
    canEdit,
    hasRowGrants,
    isRowReadOnly,
  ])

  const renderSearchBar = useCallback(
    () =>
      entityDefinitionId && resource ? (
        <RecordsSearchBar entityDefinitionId={entityDefinitionId} fields={resource.fields} />
      ) : null,
    [entityDefinitionId, resource]
  )

  const EmptyStateComponent = useCallback(
    () => (
      <div className='flex h-full items-center justify-center'>
        <EmptyState
          icon={Database}
          title={`No ${resource?.plural?.toLowerCase() ?? 'records'} found`}
          description={
            canEdit
              ? `Create your first ${resource?.label?.toLowerCase() ?? 'record'}`
              : `No ${resource?.plural?.toLowerCase() ?? 'records'} to show`
          }
          button={
            canEdit ? (
              <Button size='sm' variant='outline' onClick={() => setIsCreateDialogOpen(true)}>
                <Plus />
                Create {resource?.label ?? 'Record'}
                {createHotkey && (
                  <KbdGroup variant='default' size='sm'>
                    <Kbd>{createHotkey[0]}</Kbd>
                    <Kbd>{createHotkey[1]}</Kbd>
                  </KbdGroup>
                )}
              </Button>
            ) : undefined
          }
        />
      </div>
    ),
    [resource?.plural, resource?.label, createHotkey, setIsCreateDialogOpen, canEdit]
  )

  // Memoized element — passing a fresh `<EmptyStateComponent />` inline made the
  // DynamicView config-context value change on every render, re-rendering the
  // table body. EmptyStateComponent is already stable (useCallback), so this
  // element stays referentially stable too.
  const emptyStateElement = useMemo(() => <EmptyStateComponent />, [EmptyStateComponent])

  const { dockedPanels, overlays } = useDockedPanels([
    {
      key: 'record-detail',
      open: isDrawerOpen,
      content: (
        <RecordDrawer
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
          recordId={
            selectedInstanceId && entityDefinitionId
              ? toRecordId(entityDefinitionId, selectedInstanceId)
              : undefined
          }
          onDeleteInstance={handleDrawerDelete}
          onMutationSuccess={refresh}
        />
      ),
    },
  ])

  // Loading state
  if (isLoading) {
    return <MainPageLoading title='Loading records...' />
  }

  // Error state
  if (!resource) {
    return (
      <MainPageNotFound
        title='Entity not found'
        description={`The entity "${slug}" could not be found or you don't have access to it.`}
      />
    )
  }

  const mainContent = (
    <DynamicResourceView<EntityRow>
      viewRef={viewRef}
      slug={slug}
      baselineFilter={searchGroup ?? undefined}
      search={search}
      primaryCellRender={primaryCellRender}
      cellSelection={cellSelectionConfig}
      bulkActions={bulkActions}
      renderSearchBar={renderSearchBar}
      emptyState={emptyStateElement}
      dockedPanels={dockedPanels}
      onRowSelectionChange={handleRowSelectionChange}
      onAddNew={
        canEdit
          ? (presetValues) => {
              setCreatePresetValues(presetValues)
              setIsCreateDialogOpen(true)
            }
          : undefined
      }
      entityLabel={resource.label}
      onCardClick={handleOpenDrawer}
      onAddCard={canEdit ? () => setIsCreateDialogOpen(true) : undefined}
      selectedKanbanCardIds={selectedKanbanCardIds}
      onSelectedKanbanCardIdsChange={setSelectedKanbanCardIds}
      importHref={`${resolvedBasePath}/import`}
      namedImporters={namedImporters}
    />
  )

  const hasSelection = selectedRowIds.size > 0
  const selectionCount = selectedRowIds.size
  const selectedRows = () =>
    Array.from(selectedRowIds).map((id) => ({ id }) as unknown as EntityRow)

  return (
    <>
      {/* Tell Kopilot which entity table is on screen — enables the
          records-page view tools (preview/create view). */}
      <KopilotContext
        page='records'
        activeResourceId={entityDefinitionId}
        activeResourceLabel={resource.plural}
      />

      {/* Command-palette table scope — surfaces the table's create + bulk
          operations in cmd+k. Selection-aware rows render only when rows are
          selected; their subtitles reflect the live count. */}
      {entityDefinitionId && (
        <CommandContext
          kind='table'
          label={resource.plural}
          entityDefinitionId={entityDefinitionId}>
          {canEdit && (
            <CommandAction
              label={`Create ${resource.label}`}
              icon={resource.icon ?? 'plus'}
              keywords='create new add record'
              priority={10}
              perform={() => useCommandPaletteStore.getState().openCreate(entityDefinitionId)}
            />
          )}
          {canAdminister && (
            <CommandAction
              label='Create field'
              icon='columns'
              keywords='create field column custom attribute property'
              priority={2}
              perform={() => useCommandPaletteStore.getState().openCreateField(entityDefinitionId)}
            />
          )}
          {canEdit && (
            <CommandAction
              label='Import'
              icon='database'
              keywords='import upload csv'
              priority={1}
              perform={() => {
                useCommandPaletteStore.getState().close()
                router.push(`${resolvedBasePath}/import`)
              }}
            />
          )}
          {/* The palette is the second door to import. It has to offer the same
              set as the toolbar, or the two disagree about what can be imported. */}
          {canEdit &&
            namedImporters.map((importer) => (
              <CommandAction
                key={importer.target}
                label={importer.label}
                icon='database'
                keywords='import upload csv'
                priority={1}
                perform={() => {
                  useCommandPaletteStore.getState().close()
                  router.push(
                    `${resolvedBasePath}/import?target=${encodeURIComponent(importer.target)}`
                  )
                }}
              />
            ))}
          {hasSelection && (
            <>
              <CommandAction
                label='Run workflow'
                subtitle={`On ${selectionCount} selected`}
                icon='git-branch'
                keywords='run workflow trigger automation'
                priority={9}
                perform={() => setIsWorkflowDialogOpen(true)}
              />
              {canEdit && selectionCount >= 2 && (
                <CommandAction
                  label='Merge'
                  subtitle={`${selectionCount} selected`}
                  icon='merge'
                  keywords='merge combine dedupe'
                  priority={8}
                  perform={() => setIsMergeDialogOpen(true)}
                />
              )}
              {canEdit && (
                <>
                  <CommandAction
                    label='Edit'
                    subtitle={`${selectionCount} selected`}
                    icon='edit'
                    keywords='edit bulk update fields'
                    priority={7}
                    perform={() => setIsBulkUpdateDialogOpen(true)}
                  />
                  <CommandAction
                    label='Archive'
                    subtitle={`${selectionCount} selected`}
                    icon='archive'
                    keywords='archive bulk'
                    priority={6}
                    perform={() => handleBulkArchive(selectedRows())}
                  />
                  <CommandAction
                    label='Delete'
                    subtitle={`${selectionCount} selected`}
                    icon='trash'
                    keywords='delete remove bulk'
                    priority={5}
                    perform={() => handleBulkDelete(selectedRows())}
                  />
                </>
              )}
            </>
          )}
        </CommandContext>
      )}

      <MainPageAction>
        {pageActions}
        {canEdit && (
          <Button size='sm' className='h-7 rounded-lg' onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className='size-4' />
            Create {resource.label}
            {createHotkey && (
              <KbdGroup variant='default' size='sm'>
                <Kbd>{createHotkey[0]}</Kbd>
                <Kbd>{createHotkey[1]}</Kbd>
              </KbdGroup>
            )}
          </Button>
        )}
      </MainPageAction>

      {mainContent}

      {/* Create/Edit Dialog — resolves the custom editor per entity type (e.g. Parts). */}
      {entityDefinitionId && isCreateDialogOpen && (
        <RecordEditorDialog
          open={isCreateDialogOpen}
          onOpenChange={handleDialogOpenChange}
          entityDefinitionId={entityDefinitionId}
          recordId={
            editingInstance ? toRecordId(entityDefinitionId, editingInstance.id) : undefined
          }
          onSaved={handleDialogSaved}
          presetValues={createPresetValues}
        />
      )}

      {/* Bulk Update Dialog */}
      {entityDefinitionId && isBulkUpdateDialogOpen && (
        <BulkUpdateEntityInstanceDialog
          open={isBulkUpdateDialogOpen}
          onOpenChange={setIsBulkUpdateDialogOpen}
          recordIds={Array.from(selectedRowIds).map((id) => toRecordId(entityDefinitionId, id))}
          onSaved={() => {
            refresh()
            setSelectedRowIds(new Set())
          }}
        />
      )}

      {/* Workflow Trigger Dialog */}
      {isWorkflowDialogOpen && entityDefinitionId && (
        <MassWorkflowTriggerDialog
          open={isWorkflowDialogOpen}
          onOpenChange={setIsWorkflowDialogOpen}
          recordIds={Array.from(selectedRowIds).map((id) => toRecordId(entityDefinitionId, id))}
          onSuccess={() => {
            setSelectedRowIds(new Set())
            refresh()
          }}
        />
      )}

      {/* Merge Dialog */}
      {isMergeDialogOpen && entityDefinitionId && (
        <MergeDialog
          open={isMergeDialogOpen}
          onOpenChange={setIsMergeDialogOpen}
          baseRecordIds={Array.from(selectedRowIds).map((id) => toRecordId(entityDefinitionId, id))}
          onMergeComplete={() => {
            setSelectedRowIds(new Set())
            refresh()
          }}
        />
      )}

      {/* Add to Sequence Dialog (contact views only; dialog enforces the 50-recipient cap) */}
      {sequencesEnabled && isAddToSequenceDialogOpen && (
        <AddToSequenceDialog
          open={isAddToSequenceDialogOpen}
          onOpenChange={setIsAddToSequenceDialogOpen}
          recipientEntityInstanceIds={Array.from(selectedRowIds)}
        />
      )}

      {/* Print wizard (bulk action) — scope pinned to the frozen selection. */}
      {entityDefinitionId && isPrintWizardOpen && printSelection && (
        <PrintWizardDialog
          open={isPrintWizardOpen}
          onOpenChange={setIsPrintWizardOpen}
          entityDefinitionId={entityDefinitionId}
          tableId={`entity-${entityDefinitionId}`}
          selection={printSelection}
          onCreated={(jobId) => {
            setPrintJobId(jobId)
            setPrintProgressOpen(true)
          }}
        />
      )}
      {printJobId && (
        <ExportProgressDialog
          jobId={printJobId}
          open={printProgressOpen}
          onOpenChange={setPrintProgressOpen}
        />
      )}

      <ConfirmDeleteDialog />
      <ConfirmArchiveDialog />

      {overlays}
    </>
  )
}
