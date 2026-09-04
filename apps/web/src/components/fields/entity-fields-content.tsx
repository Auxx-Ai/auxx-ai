// apps/web/src/components/fields/entity-fields-content.tsx
'use client'

import type { FieldGroup } from '@auxx/lib/conditions/client'
import { parseRecordId, type RecordId, type ResourceField } from '@auxx/lib/resources/client'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import type { DragEndEvent, SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import { Pencil, X } from 'lucide-react'
import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import { CustomFieldDialog } from '~/components/custom-fields/ui/custom-field-dialog'
import { AddFieldRow } from './add-field-row'
import { useFieldNavigation } from './field-navigation-context'
import { FieldEditRow } from './rows/field-edit-row'
import { AddGroupRow } from './rows/field-group-row'
import { FieldValueRow } from './rows/field-value-row'
import { toPanelField } from './rows/to-panel-field'
import type { PanelField } from './rows/types'
import { FieldGroupList } from './ui/field-group-list'

/** Stable empty list, so `hideGroupHeaders` never re-keys `FieldGroupList`. */
const EMPTY_FIELD_GROUPS: FieldGroup[] = []

/**
 * Props for EntityFieldsContent component (unified version)
 */
export interface EntityFieldsContentProps {
  className?: string
  isEditMode: boolean
  /** Enter edit mode (snapshots the current view into a draft buffer) */
  onEnterEditMode: () => void
  /** Leave edit mode, discarding the draft — the footer's explicit Cancel */
  onCancelEditMode: () => void
  /**
   * Leave edit mode via the header's X. Unlike Cancel this is not a decision to
   * discard, so the owner prompts to save or discard when the draft is dirty.
   */
  onExitEditMode: () => void | Promise<void>
  /** Persist the draft (order + visibility) as one config write */
  onSaveView: () => unknown
  /** Whether the view config is currently being persisted */
  isSaving?: boolean
  dialogOpen: boolean
  setDialogOpen: (value: boolean) => void
  editingResourceFieldId: ResourceFieldId | null
  sensors: SensorDescriptor<SensorOptions>[]
  /**
   * Drop handler for a FIELD drag. `edge` names which side of the target the
   * field lands on, read from the pre-drag positions so the drop agrees with
   * the insert line.
   */
  handleDragEnd: (event: DragEndEvent, edge?: 'before' | 'after') => void
  /** Unified sorted fields (system + custom) */
  fields: ResourceField[]
  /** Loading state */
  isLoading: boolean
  /** Check if field is sortable */
  isSortable: (field: ResourceField) => boolean
  handleDeleteField: (fieldId: string, fieldName: string) => Promise<void>
  handleEditField: (fieldId: string, field: PanelField) => void
  handleAddField: () => void
  handleProviderOpenChange: (providerId: string, nextOpen: boolean) => void
  registerProviderClose: (providerId: string, closeFn: () => void) => void
  unregisterProviderClose: (providerId: string) => void
  ConfirmDeleteDialog: React.FC
  /** RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId
  /** Whether fields can be edited (default: true) */
  canEdit?: boolean
  /** Whether all fields are read-only (default: false) */
  readOnly?: boolean
  /** Whether to show field titles/labels (default: true) */
  showTitle?: boolean
  /** Callback after successful mutation */
  onMutationSuccess?: () => void
  /** Handler for toggling field visibility (edit mode only — writes the draft) */
  onToggleVisibility?: (resourceFieldId: string, visible: boolean) => void
  /** Check if a field is visible (the draft in edit mode, else the saved view) */
  isFieldVisible?: (fieldId: string) => boolean
  /**
   * Field groups for the rendered order — the draft's in edit mode, the saved
   * view's otherwise. A group carries no position: its header renders where its
   * first member sits in the field order.
   */
  fieldGroups?: FieldGroup[]
  /** Edit mode only — create an empty group, returning its id. */
  onAddGroup?: () => string
  /** Edit mode only — rename a group in the draft. */
  onRenameGroup?: (groupId: string, label: string) => void
  /** Edit mode only — delete a group (members become ungrouped; no field is deleted). */
  onDeleteGroup?: (groupId: string, label: string) => void
  /**
   * Edit mode only — move a whole group block to the drop target. `overId` is a
   * bare group id when `overIsGroup`, otherwise a field id. Order only: a block
   * move never changes membership.
   */
  onMoveGroup?: (groupId: string, overId: string, overIsGroup: boolean) => void
  /**
   * Edit mode only — place a field immediately before or after a group's block,
   * belonging to NO group. The position the row-id-only drag model could not
   * name: every target near a group used to read as "join that group", so a
   * group rendered first swallowed anything dragged to the top of the list.
   */
  onPlaceFieldBesideGroup?: (fieldId: string, groupId: string, side: 'before' | 'after') => void
  /**
   * Suppress the in-panel group chrome (headers, and the collapse/rename
   * affordances that hang off them), rendering the fields as one flat list.
   *
   * For a `fields` block that has been narrowed to ONE promoted group
   * (`plans/drawer/record-layout-system.md` §4): the block's own `<Section>`
   * already carries that group's label, so drawing the group header again inside
   * the panel prints the same name twice. Additive and off by default, so every
   * existing panel is unchanged.
   */
  hideGroupHeaders?: boolean
}

/**
 * Inner component that uses the navigation context
 * Renders the unified field list with drag-and-drop support
 */
export function EntityFieldsContent({
  className,
  isEditMode,
  onEnterEditMode,
  onCancelEditMode,
  onExitEditMode,
  onSaveView,
  isSaving = false,
  dialogOpen,
  setDialogOpen,
  editingResourceFieldId,
  sensors,
  handleDragEnd,
  fields,
  isLoading,
  isSortable,
  handleDeleteField,
  handleEditField,
  handleAddField,
  handleProviderOpenChange,
  registerProviderClose,
  unregisterProviderClose,
  ConfirmDeleteDialog,
  recordId,
  onMutationSuccess,
  canEdit = true,
  readOnly = false,
  showTitle = true,
  onToggleVisibility,
  isFieldVisible,
  fieldGroups,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onPlaceFieldBesideGroup,
  hideGroupHeaders = false,
}: EntityFieldsContentProps) {
  // Parse recordId to get entityDefinitionId
  const { entityDefinitionId } = parseRecordId(recordId)

  const containerRef = useRef<HTMLDivElement>(null)
  const { focusedRowId, moveFocus, openFocusedRow, isPopoverCapturing } = useFieldNavigation()

  /**
   * Handle keyboard navigation at container level
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isPopoverCapturing) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          moveFocus('down')
          break
        case 'ArrowUp':
          e.preventDefault()
          moveFocus('up')
          break
        case 'Enter':
          if (focusedRowId) {
            e.preventDefault()
            openFocusedRow()
          }
          break
      }
    },
    [isPopoverCapturing, moveFocus, focusedRowId, openFocusedRow]
  )

  /**
   * Normalize a registry field into the shape rows consume, and derive the ids
   * each row needs. System fields have no DB id, so they fall back to their key.
   *
   * `id` is the drag-and-drop id AND the visibility key, and it is deliberately
   * the id `FieldViewConfig.fieldOrder` / `fieldVisibility` store — anything else
   * makes a reorder or a toggle a silent no-op against the draft config.
   */
  const rows = fields.map((field, index) => {
    const isSystemField = field.isSystem === true
    const fieldId = field.id || field.key
    const viewFieldId = String(field.resourceFieldId ?? field.id ?? field.key)
    return {
      id: viewFieldId,
      index,
      isSystemField,
      // System keys and custom-field ids share one namespace, so system rows are
      // prefixed to guarantee uniqueness.
      providerId: isSystemField ? `system-${field.key}` : fieldId,
      resourceFieldId: viewFieldId,
      isVisible: isFieldVisible?.(viewFieldId) ?? true,
      isSortable: isSortable(field),
      field: toPanelField(field, readOnly),
    }
  })

  type FieldRow = (typeof rows)[number]

  /** The group whose label input should take focus (just created in this session). */
  const [newGroupId, setNewGroupId] = useState<string | null>(null)

  const handleAddGroup = () => {
    const groupId = onAddGroup?.()
    if (groupId) setNewGroupId(groupId)
  }

  return (
    <>
      {/* Confirm delete dialog */}
      <ConfirmDeleteDialog />

      {/* Custom Field Dialog for creating/editing fields */}
      {dialogOpen && (
        <CustomFieldDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          resourceFieldId={editingResourceFieldId}
          entityDefinitionId={entityDefinitionId}
          onSuccess={onMutationSuccess}
        />
      )}

      {/* Styled card container with keyboard navigation */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'group/entity-card bg-primary-100/50 dark:bg-[#23272e]/50 dark:border rounded-2xl relative outline-none focus:outline-none',
          'ring-border-illustration shadow-black/6.5 shadow-md ring-1',
          className
        )}>
        <div className='flex rounded-md gap-0 p-3 pe-2 self-stretch flex-col'>
          {/* Edit mode header */}
          {canEdit && (
            <div
              className={cn(
                'absolute -top-4 -right-3 z-80 rounded-full transition-opacity duration-200 ring ring-border bg-background flex items-center justify-center size-7 shadow-md backdrop-blur-sm',
                isEditMode ? 'opacity-100' : 'opacity-0 group-hover/entity-card:opacity-100'
              )}>
              <Button
                variant='ghost'
                size='icon-xs'
                onClick={() => (isEditMode ? void onExitEditMode() : onEnterEditMode())}
                className={cn(
                  'cursor-pointer',
                  isEditMode
                    ? 'bg-bad-200 hover:bg-bad-200 text-bad-700 hover:text-bad-800'
                    : 'text-muted-foreground hover:text-foreground'
                )}>
                {isEditMode ? <X /> : <Pencil />}
              </Button>
            </div>
          )}

          {/* The grouped list and the whole drag model — shared with the record
              dialog's config mode, so the two surfaces can never drift apart. */}
          <FieldGroupList<FieldRow>
            rows={rows}
            rowId={(row) => row.id}
            rowKey={(row) => row.providerId}
            // Handing `FieldGroupList` no groups is what removes the chrome:
            // it draws a header where each group's first member sits, so an
            // empty group list renders the same rows as one flat run.
            groups={hideGroupHeaders ? EMPTY_FIELD_GROUPS : (fieldGroups ?? [])}
            isEditMode={isEditMode}
            canEdit={canEdit}
            sensors={sensors}
            onFieldDragEnd={handleDragEnd}
            onPlaceFieldBesideGroup={onPlaceFieldBesideGroup}
            onMoveGroup={onMoveGroup}
            onRenameGroup={onRenameGroup}
            onDeleteGroup={onDeleteGroup}
            newGroupId={newGroupId}
            renderRow={(row, ctx) =>
              isEditMode ? (
                <FieldEditRow
                  id={row.id}
                  field={row.field}
                  isSortable={row.isSortable}
                  resourceFieldId={row.resourceFieldId}
                  isVisible={row.isVisible}
                  // Preview rows carry no actions — `FieldEditRow` renders the
                  // pencil, trash and visibility switch only when handed their
                  // handlers, so withholding them is what leaves the ghost as
                  // icon + name.
                  onEdit={ctx.preview || row.isSystemField ? undefined : handleEditField}
                  onDelete={ctx.preview || row.isSystemField ? undefined : handleDeleteField}
                  onToggleVisibility={ctx.preview ? undefined : onToggleVisibility}
                />
              ) : (
                <FieldValueRow
                  providerId={row.providerId}
                  field={row.field}
                  index={ctx.navIndex}
                  loading={isLoading}
                  recordId={recordId}
                  readOnly={readOnly}
                  showTitle={showTitle}
                  onOpenChange={handleProviderOpenChange}
                  registerClose={registerProviderClose}
                  unregisterClose={unregisterProviderClose}
                />
              )
            }
          />

          {/* Add Field / Add Group — edit mode only, same permission gate */}
          {isEditMode && canEdit && (
            <>
              <AddFieldRow onClick={handleAddField} />
              {onAddGroup && <AddGroupRow onClick={handleAddGroup} />}
            </>
          )}

          {/* Draft footer — the drawer has no DialogFooter, so Save/Cancel live
              inside the card. Order and visibility are buffered locally until
              Save View writes them as one config update. */}
          {isEditMode && canEdit && (
            <div className='mt-2 flex items-center justify-end gap-2 border-border/60 border-t pt-2'>
              <Button size='sm' variant='ghost' onClick={onCancelEditMode} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void onSaveView()}
                loading={isSaving}
                loadingText='Saving...'>
                Save View
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
