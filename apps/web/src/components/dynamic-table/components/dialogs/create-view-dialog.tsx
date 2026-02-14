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
import { LayoutGrid, Table2 } from 'lucide-react'
import { useState } from 'react'
import { useViewMutations } from '../../hooks/use-view-mutations'
import type { TableView, ViewConfig } from '../../types'

/** Select field for kanban grouping */
interface SelectField {
  id: string
  name: string
  options?: { options?: Array<{ id: string; label: string; color?: string }> }
}

export interface CreateViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  views: TableView[]
  /** SINGLE_SELECT fields available for kanban grouping */
  selectFields?: SelectField[]
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
  entityDefinitionId,
  currentFilters,
  onViewCreated,
  currentTableState,
}: CreateViewDialogProps) {
  const [newViewName, setNewViewName] = useState('')
  const [viewType, setViewType] = useState<'table' | 'kanban'>('table')
  const [selectedFieldId, setSelectedFieldId] = useState<string>('')
  const [isCreatingField, setIsCreatingField] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')

  const { createView } = useViewMutations(tableId)

  /** Handle view creation */
  const handleCreateView = async () => {
    // For kanban, need either a selected field or a new field name
    if (viewType === 'kanban' && !selectedFieldId && !newFieldName.trim()) return

    // Generate name if not provided
    const existingNames = new Set(views.map((v) => v.name))
    const baseTitle = viewType === 'kanban' ? 'Kanban View' : 'Table View'
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
    }

    // If creating new field, pass newField config with entityDefinitionId
    const newField =
      viewType === 'kanban' && !selectedFieldId && newFieldName.trim()
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
              onValueChange={(v) => setViewType(v as 'table' | 'kanban')}>
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
            </RadioGroup>
          </div>

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
                  addAction={{
                    label: 'New Status Field',
                    onAdd: () => {
                      setIsCreatingField(true)
                      setSelectedFieldId('') // Clear selected field when creating new
                    },
                  }}
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
              (viewType === 'kanban' && !selectedFieldId && !newFieldName.trim())
            }>
            Create View <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
