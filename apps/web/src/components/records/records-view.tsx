// apps/web/src/components/records/records-view.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { isAiEligible } from '@auxx/lib/custom-fields/client'
import { converters } from '@auxx/lib/field-values/client'
import type { RecordId, ResourceField } from '@auxx/lib/resources/client'
import type { ActorId } from '@auxx/types/actor'
import type { AiOptions } from '@auxx/types/custom-field'
import { toFieldId, toResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { Kbd, KbdGroup } from '@auxx/ui/components/kbd'
import Loader from '@auxx/ui/components/loader'
import {
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Archive, Combine, Database, FileText, Play, Plus, SquarePen, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { parseAsBoolean, parseAsString, useQueryState } from 'nuqs'
import { useCallback, useMemo, useRef, useState } from 'react'
import { BulkUpdateEntityInstanceDialog } from '~/components/custom-fields/ui/bulk-update-entity-instance-dialog'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import type { CellSelectionConfig } from '~/components/dynamic-table'
import { PrimaryFieldCell } from '~/components/dynamic-table'
import {
  DynamicResourceView,
  type DynamicResourceViewHandle,
} from '~/components/dynamic-table/dynamic-resource-view'
import { decodeColumnId } from '~/components/dynamic-table/utils/column-id'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { EmptyState } from '~/components/global/empty-state'
import { getCreateHotkey } from '~/components/global-create/system-hotkeys'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { MergeDialog } from '~/components/merge'
import { type RecordMeta, toRecordId, useResource } from '~/components/resources'
import { useRunAiBulkGenerate } from '~/components/resources/hooks/run-ai-bulk-generate'
import { useSaveFieldValue } from '~/components/resources/hooks/use-save-field-value'
import { useActorStore } from '~/components/resources/store/actor-store'
import { useRelationshipStore } from '~/components/resources/store/relationship-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { MassWorkflowTriggerDialog } from '~/components/workflow/mass-workflow-trigger-dialog'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useEntityInstanceOperations } from '~/hooks/use-entity-instance-operations'
import { useDockStore } from '~/stores/dock-store'
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
  /** When true, RecordsView renders without its own MainPage wrapper (parent provides it) */
  embedded?: boolean
  /** When false, suppresses the built-in EntityInstanceDialog. Default: true.
   *  Use this when the parent renders its own create/edit dialog listening to ?create=true. */
  renderCreateDialog?: boolean
  /** Called when the user triggers an edit on a record (e.g. primary field edit button).
   *  Only relevant when renderCreateDialog is false — lets the parent open its own edit dialog. */
  onEditRecord?: (recordId: RecordId) => void
}

/**
 * RecordsView component
 * Composes DynamicResourceView with the records-specific primary cell,
 * bulk-action set, paste/fill/AI cell selection config, and dialogs.
 */
export function RecordsView({
  slug,
  basePath,
  embedded,
  renderCreateDialog,
  onEditRecord,
}: RecordsViewProps) {
  const resolvedBasePath = basePath ?? `/app/custom/${slug}`
  const router = useRouter()

  // Dock state
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Resource is needed in this scope for header/breadcrumb labels and to
  // build the cellSelection config. DynamicResourceView resolves its own
  // copy from the same store — both share the same subscription.
  const { resource, isLoading } = useResource(slug)
  const entityDefinitionId = resource?.id
  const createHotkey = getCreateHotkey(resource?.apiSlug)

  // Imperative handle into DynamicResourceView for refresh + field-value reads
  // (paste/fill needs getValue from the inner syncer).
  const viewRef = useRef<DynamicResourceViewHandle | null>(null)

  // Create dialog state — synced with ?create URL param for external triggers (e.g. layout header button)
  const [createParam, setCreateParam] = useQueryState('create', parseAsBoolean.withDefault(false))
  const [isCreateDialogOpenInternal, setIsCreateDialogOpenInternal] = useState(false)
  const isCreateDialogOpen = isCreateDialogOpenInternal || createParam
  const setIsCreateDialogOpen = useCallback(
    (open: boolean) => {
      if (renderCreateDialog === false) {
        // Parent handles the dialog — communicate via URL param only
        setCreateParam(open || null)
      } else {
        setIsCreateDialogOpenInternal(open)
        if (!open && createParam) setCreateParam(null)
      }
    },
    [createParam, setCreateParam, renderCreateDialog]
  )

  // Local state
  const [editingInstance, setEditingInstance] = useState<EntityRow | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

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
      if (onEditRecord && entityDefinitionId) {
        onEditRecord(toRecordId(entityDefinitionId, row.id))
      } else {
        setEditingInstance(row)
      }
      setIsCreateDialogOpen(true)
    },
    [setIsCreateDialogOpen, onEditRecord, entityDefinitionId]
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
    refresh()
  }, [refresh])

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsCreateDialogOpen(open)
      if (!open) {
        setEditingInstance(null)
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
          <DropdownMenuItem onClick={() => handleOpenEditDialog(row)}>
            <SquarePen />
            Edit
          </DropdownMenuItem>
          <FavoriteToggleMenuItem
            targetType='ENTITY_INSTANCE'
            targetIds={{
              entityDefinitionId,
              entityInstanceId: row.id,
            }}
          />
          <DropdownMenuItem onClick={() => handleArchive(row.id)}>
            <Archive />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onClick={() => handleDelete(row.id)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </PrimaryFieldCell>
      )
    },
    [
      entityDefinitionId,
      primaryResourceFieldId,
      handleOpenDrawer,
      handleOpenEditDialog,
      handleArchive,
      handleDelete,
    ]
  )

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
      {
        label: 'Merge',
        icon: Combine,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          setSelectedRowIds(new Set(rows.map((r) => r.id)))
          setIsMergeDialogOpen(true)
        },
      },
      {
        label: 'Edit',
        icon: SquarePen,
        variant: 'outline' as const,
        action: (rows: EntityRow[]) => {
          setSelectedRowIds(new Set(rows.map((r) => r.id)))
          setIsBulkUpdateDialogOpen(true)
        },
      },
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
    ],
    [handleBulkArchive, handleBulkDelete]
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
  }, [entityDefinitionId, fieldMap, saveBulkMultipleFields, runAiBulkGenerate])

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
          description={`Create your first ${resource?.label?.toLowerCase() ?? 'record'}`}
          button={
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
          }
        />
      </div>
    ),
    [resource?.plural, resource?.label, createHotkey, setIsCreateDialogOpen]
  )

  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    if (!isDocked || !isDrawerOpen || !selectedInstanceId || !entityDefinitionId) return []
    return [
      {
        key: 'record-detail',
        content: (
          <RecordDrawer
            open={isDrawerOpen}
            onOpenChange={handleDrawerOpenChange}
            recordId={toRecordId(entityDefinitionId, selectedInstanceId)}
            onDeleteInstance={handleDrawerDelete}
            onMutationSuccess={refresh}
          />
        ),
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth,
        maxWidth,
      },
    ]
  }, [
    isDocked,
    isDrawerOpen,
    selectedInstanceId,
    entityDefinitionId,
    handleDrawerOpenChange,
    handleDrawerDelete,
    refresh,
    dockedWidth,
    setDockedWidth,
    minWidth,
    maxWidth,
  ])

  // Loading state
  if (isLoading) {
    const loadingContent = (
      <MainPageContent>
        <div className='flex h-full items-center justify-center'>
          <Loader size='sm' title='Loading records...' subtitle='Please wait' />
        </div>
      </MainPageContent>
    )
    if (embedded) return loadingContent
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Loading...' href={resolvedBasePath} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {loadingContent}
      </MainPage>
    )
  }

  // Error state
  if (!resource) {
    const errorContent = (
      <MainPageContent>
        <div className='flex h-full items-center justify-center'>
          <EmptyState
            icon={FileText}
            title='Entity not found'
            description={`The entity "${slug}" could not be found or you don't have access to it.`}
          />
        </div>
      </MainPageContent>
    )
    if (embedded) return errorContent
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Not Found' href={resolvedBasePath} last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        {errorContent}
      </MainPage>
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
      emptyState={<EmptyStateComponent />}
      dockedPanels={dockedPanels}
      onRowSelectionChange={handleRowSelectionChange}
      onAddNew={() => setIsCreateDialogOpen(true)}
      entityLabel={resource.label}
      onCardClick={handleOpenDrawer}
      onAddCard={() => setIsCreateDialogOpen(true)}
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
      {/* Command-palette table scope — surfaces the table's create + bulk
          operations in cmd+k. Selection-aware rows render only when rows are
          selected; their subtitles reflect the live count. */}
      {entityDefinitionId && (
        <CommandContext
          kind='table'
          label={resource.plural}
          entityDefinitionId={entityDefinitionId}>
          <CommandAction
            label={`Create ${resource.label}`}
            icon={resource.icon ?? 'plus'}
            keywords='create new add record'
            priority={10}
            perform={() => useCommandPaletteStore.getState().openCreate(entityDefinitionId)}
          />
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
              {selectionCount >= 2 && (
                <CommandAction
                  label='Merge'
                  subtitle={`${selectionCount} selected`}
                  icon='merge'
                  keywords='merge combine dedupe'
                  priority={8}
                  perform={() => setIsMergeDialogOpen(true)}
                />
              )}
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
        </CommandContext>
      )}

      {embedded ? (
        mainContent
      ) : (
        <MainPage>
          <MainPageHeader
            action={
              <Button
                size='sm'
                className='h-7 rounded-lg'
                onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className='size-4' />
                Create {resource.label}
                {createHotkey && (
                  <KbdGroup variant='default' size='sm'>
                    <Kbd>{createHotkey[0]}</Kbd>
                    <Kbd>{createHotkey[1]}</Kbd>
                  </KbdGroup>
                )}
              </Button>
            }>
            <MainPageBreadcrumb>
              <MainPageBreadcrumbItem title={resource.plural} href={resolvedBasePath} last />
            </MainPageBreadcrumb>
          </MainPageHeader>
          {mainContent}
        </MainPage>
      )}

      {/* Create/Edit Dialog */}
      {renderCreateDialog !== false && entityDefinitionId && isCreateDialogOpen && (
        <EntityInstanceDialog
          open={isCreateDialogOpen}
          onOpenChange={handleDialogOpenChange}
          entityDefinitionId={entityDefinitionId}
          recordId={
            editingInstance ? toRecordId(entityDefinitionId, editingInstance.id) : undefined
          }
          onSaved={handleDialogSaved}
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

      <ConfirmDeleteDialog />
      <ConfirmArchiveDialog />

      {/* Record Drawer - only render overlay when NOT docked */}
      {!isDocked && (
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
      )}
    </>
  )
}
