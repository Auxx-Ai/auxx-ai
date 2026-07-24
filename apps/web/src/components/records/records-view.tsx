// apps/web/src/components/records/records-view.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { isAiEligible } from '@auxx/lib/custom-fields/client'
import { converters } from '@auxx/lib/field-values/client'
import { FeatureKey } from '@auxx/lib/permissions/client'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import type { AiOptions } from '@auxx/types/custom-field'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import { MainPageAction } from '@auxx/ui/components/main-page'
import { useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Combine,
  Database,
  Expand,
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
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { EmptyState } from '~/components/global/empty-state'
import { MainPageLoading, MainPageNotFound } from '~/components/global/main-page-states'
import { getCreateHotkey } from '~/components/global-create/system-hotkeys'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { KopilotContext } from '~/components/kopilot/context'
import { MergeDialog } from '~/components/merge'
import { PrintWizardDialog } from '~/components/print/ui/print-wizard-dialog'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import {
  getRecordLink,
  type RecordMeta,
  resourceHasDetailPage,
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
import { searchConditionsToGroup, useRecordsSearchStore } from './records-search-store'
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

  // Per-def write gate (Layer 2 × Layer 3) — the single `edit`-floor predicate
  // that governs every record write on this def (create/update/delete/archive/
  // merge all sit at the same floor, §0.1). Hides those affordances for a member
  // who can view but not edit this def (Read-only grantee / field seat). The
  // server enforces regardless; this just avoids a click-then-403. Keyed by
  // `entityDefinitionId` (the defAccess keyspace), not `resource.id`.
  const { canEditEntity } = useAccess()
  const canEdit = resource ? canEditEntity(resource.entityDefinitionId) : false

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

  // Print wizard (bulk-action entry — scope pinned to the frozen selection) + its progress
  // dialog, wired exactly like the CSV export flow (`table-toolbar.tsx`'s toolbar entry).
  const [printSelection, setPrintSelection] = useState<{ recordIds: RecordId[] } | null>(null)
  const [isPrintWizardOpen, setIsPrintWizardOpen] = useState(false)
  const [printJobId, setPrintJobId] = useState<string | null>(null)
  const [printProgressOpen, setPrintProgressOpen] = useState(false)

  // Search bar conditions are records-specific (one global store).
  // DynamicResourceView can't import this store; we feed it the merged
  // ConditionGroup as a baselineFilter on every render.
  const searchConditions = useRecordsSearchStore((s) => s.conditions)
  const searchGroup = useMemo(() => searchConditionsToGroup(searchConditions), [searchConditions])

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

  const {
    handleArchive,
    handleDelete,
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

  const handleDialogSaved = useCallback(() => {
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
  }, [refresh, queryClient])

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

  // Primary cell renderer — title + Edit / Favorite / Archive / Delete dropdown.
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
          onTitleClick={() => handleOpenDrawer(row)}>
          {canEdit && (
            <DropdownMenuItem onClick={() => handleOpenEditDialog(row)}>
              <SquarePen />
              Edit
            </DropdownMenuItem>
          )}
          {resource && resourceHasDetailPage(resource) && (
            <DropdownMenuItem
              onClick={() => {
                const href = getRecordLink(toRecordId(entityDefinitionId, row.id), resource)
                if (href) router.push(href)
              }}>
              <Expand />
              Open full page
            </DropdownMenuItem>
          )}
          <FavoriteToggleMenuItem
            targetType='ENTITY_INSTANCE'
            targetIds={{
              entityDefinitionId,
              entityInstanceId: row.id,
            }}
          />
          {canEdit && (
            <>
              <DropdownMenuItem onClick={() => handleArchive(row.id)}>
                <Archive />
                Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => handleDelete(row.id)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </PrimaryFieldCell>
      )
    },
    [
      canEdit,
      entityDefinitionId,
      primaryResourceFieldId,
      resource,
      router,
      handleOpenDrawer,
      handleOpenEditDialog,
      handleArchive,
      handleDelete,
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
    const readValue = (recordId: RecordId, columnId: string) =>
      viewRef.current?.getValue(recordId, columnId)

    const resolveField = (columnId: string): ResourceField | null => {
      if (columnId.startsWith('_')) return null
      const decoded = decodeColumnId(columnId)
      if (decoded.type === 'path') {
        const lastResourceFieldId = decoded.fieldPath[decoded.fieldPath.length - 1]
        return fieldMap[lastResourceFieldId] ?? null
      }
      return fieldMap[decoded.resourceFieldId] ?? null
    }

    return {
      enabled: true,
      // Read-only degrade for members below Edit on this def — keeps selection +
      // copy, disables every inline write path (server enforces regardless).
      readOnly: !canEdit,
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
        const targetDefId = field.options?.relationship?.relatedEntityDefinitionId
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
  }, [entityDefinitionId, fieldMap, saveBulkMultipleFields, runAiBulkGenerate, canEdit])

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
          <CommandAction
            label='Create field'
            icon='columns'
            keywords='create field column custom attribute property'
            priority={2}
            perform={() => useCommandPaletteStore.getState().openCreateField(entityDefinitionId)}
          />
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
