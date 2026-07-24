// apps/web/src/components/dynamic-table/components/dialogs/create-view-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Combobox } from '@auxx/ui/components/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItemCard } from '@auxx/ui/components/radio-group'
import { incrementTitle } from '@auxx/utils'
import type {
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'
import { Calendar, LayoutGrid, Table2 } from 'lucide-react'
import { useState } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { useViewMutations } from '../../hooks/use-view-mutations'
import type { TableView, ViewConfig } from '../../types'

/** Select field for kanban grouping */
interface SelectField {
  id: string
  name: string
  options?: { options?: Array<{ id: string; label: string; color?: string }> }
}

/** DATE/DATETIME field for the calendar view's date axis */
interface DateField {
  id: string
  name: string
}

export interface CreateViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  views: TableView[]
  /** SINGLE_SELECT fields available for kanban grouping */
  selectFields?: SelectField[]
  /** DATE/DATETIME fields available for the calendar view's date axis */
  dateFields?: DateField[]
  /** Entity definition ID for field creation */
  entityDefinitionId?: string
  /** Current filters to pre-populate when creating a new view */
  currentFilters?: ViewConfig['filters']
  /** Callback when view is successfully created */
  onViewCreated?: (viewId: string) => void
  /** Current table state to capture when creating view */
  currentTableState?: {
    columnVisibility: VisibilityState
    columnOrder: ColumnOrderState
    columnSizing: ColumnSizingState
    columnPinning: ColumnPinningState
    sorting: SortingState
  }
}

/**
 * Dialog for creating new table or kanban views
 */
export function CreateViewDialog({
  open,
  onOpenChange,
  tableId,
  views,
  selectFields,
  dateFields,
  entityDefinitionId,
  currentFilters,
  onViewCreated,
  currentTableState,
}: CreateViewDialogProps) {
  const [newViewName, setNewViewName] = useState('')
  const [viewType, setViewType] = useState<'table' | 'kanban' | 'calendar'>('table')
  const [selectedFieldId, setSelectedFieldId] = useState<string>('')
  const [isCreatingField, setIsCreatingField] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [selectedDateFieldId, setSelectedDateFieldId] = useState<string>('')

  const { createView } = useViewMutations(tableId)
  const { canAdministerDef } = useAccess()
  const hasDateFields = (dateFields ?? []).length > 0
  const canCreateField = entityDefinitionId ? canAdministerDef(entityDefinitionId) : false

  /** Handle view creation */
  const handleCreateView = async () => {
    // For kanban, need either a selected field or a new field name
    if (viewType === 'kanban' && !selectedFieldId && !newFieldName.trim()) return
    // For calendar, a date field is required
    if (viewType === 'calendar' && !selectedDateFieldId) return

    // Generate name if not provided
    const existingNames = new Set(views.map((v) => v.name))
    const baseTitle =
      viewType === 'kanban'
        ? 'Kanban View'
        : viewType === 'calendar'
          ? 'Calendar View'
          : 'Table View'
    const viewName = newViewName.trim() || incrementTitle(baseTitle, existingNames)

    const config: ViewConfig = {
      filters: currentFilters ?? [],
      sorting: currentTableState?.sorting ?? [],
      columnVisibility: currentTableState?.columnVisibility ?? {},
      columnOrder: currentTableState?.columnOrder ?? [],
      columnSizing: currentTableState?.columnSizing ?? {},
      columnPinning: currentTableState?.columnPinning,
      viewType,
      ...(viewType === 'kanban' && {
        kanban: {
          // Use empty string if creating new field - backend will populate
          groupByFieldId: selectedFieldId || '',
        },
      }),
      ...(viewType === 'calendar' && {
        calendar: {
          dateFieldId: selectedDateFieldId,
          cardFields: [],
        },
      }),
    }

    // If creating new field, pass newField config with entityDefinitionId
    const newField =
      viewType === 'kanban' && !selectedFieldId && newFieldName.trim() && entityDefinitionId
        ? {
            name: newFieldName.trim(),
            entityDefinitionId,
          }
        : undefined

    const newView = await createView.mutateAsync({
      tableId,
      name: viewName,
      config,
      newField,
    })

    // Navigate to the newly created view
    onViewCreated?.(newView.id)

    // Reset state and close dialog
    resetState()
    onOpenChange(false)
  }

  /** Reset all form state */
  const resetState = () => {
    setNewViewName('')
    setViewType('table')
    setSelectedFieldId('')
    setNewFieldName('')
    setIsCreatingField(false)
    setSelectedDateFieldId('')
  }

  /** Handle dialog close */
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetState()
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Create New View</DialogTitle>
          <DialogDescription>
            Create a new view to save your current configuration
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          {/* View name input */}
          <div className='flex flex-col space-y-2'>
            <Label htmlFor='view-name'>Name (Optional)</Label>
            <Input
              id='view-name'
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder='View name...'
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateView()
                }
              }}
            />
          </div>

          {/* View type selector */}
          <div className='flex flex-col space-y-2'>
            <Label>View Type</Label>
            <RadioGroup
              value={viewType}
              onValueChange={(v) => setViewType(v as 'table' | 'kanban' | 'calendar')}>
              <RadioGroupItemCard
                label='Table'
                value='table'
                icon={<Table2 />}
                description='Organize your records on a table'
              />
              <RadioGroupItemCard
                label='Kanban'
                value='kanban'
                icon={<LayoutGrid />}
                description='Organize records on a pipeline'
              />
              <RadioGroupItemCard
                label='Calendar'
                value='calendar'
                icon={<Calendar />}
                disabled={!hasDateFields}
                description={
                  hasDateFields
                    ? 'Organize records on a date-based month grid'
                    : 'Requires a DATE or DATETIME field on this entity'
                }
              />
            </RadioGroup>
          </div>

          {/* Date field selector for calendar */}
          {viewType === 'calendar' && (
            <div className='space-y-2 flex flex-col'>
              <Label>Date field</Label>
              <Combobox
                options={(dateFields ?? []).map((f) => ({ value: f.id, label: f.name }))}
                placeholder='Select a date field...'
                emptyText='No date fields found'
                value={selectedDateFieldId}
                onChangeValue={setSelectedDateFieldId}
              />
            </div>
          )}

          {/* Field selector for kanban */}
          {viewType === 'kanban' && (
            <div className='space-y-2 flex flex-col'>
              <Label>Group by field</Label>
              {isCreatingField ? (
                // Inline creation mode - Input field
                <InputGroup>
                  <InputGroupInput
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder='Field name...'
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsCreatingField(false)
                        setNewFieldName('')
                      }
                    }}
                  />
                  <InputGroupAddon align='inline-end'>
                    <InputGroupButton
                      type='button'
                      className='rounded-lg me-0.5'
                      variant='destructive-hover'
                      aria-label='Cancel'
                      title='Cancel'
                      size='xs'
                      onClick={() => {
                        setIsCreatingField(false)
                        setNewFieldName('')
                      }}>
                      Cancel
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              ) : (
                // Combobox selection mode
                <Combobox
                  options={(selectFields ?? []).map((f) => ({ value: f.id, label: f.name }))}
                  placeholder='Select a status field...'
                  emptyText='No single-select fields found'
                  value={selectedFieldId}
                  onChangeValue={(value) => {
                    setSelectedFieldId(value)
                    setNewFieldName('') // Clear any pending new field name
                  }}
                  addAction={
                    canCreateField
                      ? {
                          label: 'New Status Field',
                          onAdd: () => {
                            setIsCreatingField(true)
                            setSelectedFieldId('') // Clear selected field when creating new
                          },
                        }
                      : undefined
                  }
                />
              )}
              {/* Show the new field name that will be created */}
              {isCreatingField && newFieldName.trim() && (
                <p className='text-xs text-muted-foreground'>
                  A new &quot;{newFieldName}&quot; field will be created when you save this view.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button size='sm' variant='ghost' onClick={() => handleOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            data-dialog-submit
            onClick={handleCreateView}
            size='sm'
            variant='outline'
            loading={createView.isPending}
            loadingText='Creating...'
            disabled={
              createView.isPending ||
              (viewType === 'kanban' && !selectedFieldId && !newFieldName.trim()) ||
              (viewType === 'calendar' && !selectedDateFieldId)
            }>
            Create View <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
