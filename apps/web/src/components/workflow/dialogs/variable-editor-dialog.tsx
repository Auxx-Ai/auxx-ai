// apps/web/src/components/workflow/dialogs/variable-editor-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Label } from '@auxx/ui/components/label'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  Check,
  Edit2,
  Minus,
  Plus,
  Trash2,
  Variable,
  Variable as VariableIcon,
  X,
} from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useVarStore } from '~/components/workflow/store/use-var-store'
import type { EnvVar } from '~/components/workflow/types'
import { BaseType } from '~/components/workflow/types/unified-types'
import {
  VariableTypePicker,
  type VariableTypeValue,
} from '~/components/workflow/ui/variable-type-picker'
import { useConfirm } from '~/hooks/use-confirm'

interface VariableEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface VariableFormData {
  id?: string
  name: string
  value: any
  typeValue: VariableTypeValue
}

/**
 * Get default value for a given type
 */
const getDefaultValue = (typeValue: VariableTypeValue) => {
  if (typeValue.isArray) return []

  switch (typeValue.baseType) {
    case BaseType.BOOLEAN:
      return false
    case BaseType.NUMBER:
      return 0
    case BaseType.STRING:
    case BaseType.SECRET:
    default:
      return ''
  }
}

/**
 * Array value editor component
 */
function ArrayValueEditor({
  value,
  onChange,
}: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  const addItem = () => {
    onChange([...value, ''])
  }

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, newValue: string) => {
    const newArray = [...value]
    newArray[index] = newValue
    onChange(newArray)
  }

  return (
    <div className='space-y-2'>
      {value.map((item, index) => (
        <InputGroup key={index}>
          <InputGroupInput
            value={item}
            onChange={(e) => updateItem(index, e.target.value)}
            placeholder={`Item ${index + 1}`}
            className='flex-1'
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupButton
              type='button'
              className='rounded-full'
              aria-label='Remove item'
              title='Remove'
              size='icon-xs'
              onClick={() => removeItem(index)}>
              <Trash2 />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      ))}
      <Button type='button' variant='ghost' size='xs' onClick={addItem} className=''>
        <Plus />
        Add Item
      </Button>
    </div>
  )
}

/**
 * Variable item display component
 */
function VariableItem({
  variable,
  onEdit,
  onDelete,
  isSelected,
  onSelect,
  bulkSelectMode,
  isChecked,
  onCheck,
}: {
  variable: EnvVar
  onEdit: (variable: EnvVar) => void
  onDelete: (id: string) => void
  isSelected?: boolean
  onSelect?: (id: string) => void
  bulkSelectMode?: boolean
  isChecked?: boolean
  onCheck?: (id: string, checked: boolean) => void
}) {
  const displayValue = () => {
    if (variable.type === 'secret') {
      return '••••••••'
    }
    if (typeof variable.value === 'object') {
      return JSON.stringify(variable.value)
    }
    return String(variable.value)
  }

  return (
    <div
      className={cn(
        'group flex h-9 pe-1 ps-2 items-center gap-3 rounded-2xl border hover:bg-muted/50 transition-colors',
        isSelected && 'bg-accent border-accent-foreground/20',
        bulkSelectMode ? 'cursor-default' : 'cursor-pointer'
      )}
      onClick={() => !bulkSelectMode && onSelect?.(variable.id)}
      role={bulkSelectMode ? undefined : 'button'}
      tabIndex={bulkSelectMode ? undefined : 0}
      aria-label={`Environment variable ${variable.name}`}>
      {bulkSelectMode && (
        <Checkbox
          checked={isChecked || false}
          onCheckedChange={(checked) => onCheck?.(variable.id, checked === true)}
          aria-label={`Select ${variable.name}`}
        />
      )}
      <VariableIcon className='size-4 text-muted-foreground' />
      <div className='flex-1 min-w-0'>
        <div className='flex items-center gap-2'>
          <span className='font-medium text-sm'>{variable.name}</span>
          <span className='text-xs bg-secondary px-2 py-0.5 rounded'>{variable.type}</span>
          <div className='text-xs text-muted-foreground font-mono truncate'>{displayValue()}</div>
        </div>
      </div>
      {!bulkSelectMode && (
        <div className='opacity-0 group-hover:opacity-100 transition-opacity flex gap-1'>
          <Button
            variant='ghost'
            size='icon-sm'
            onClick={(e) => {
              e.stopPropagation()
              onEdit(variable)
            }}
            aria-label={`Edit ${variable.name}`}>
            <Edit2 />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            className='text-destructive hover:text-destructive'
            onClick={(e) => {
              e.stopPropagation()
              onDelete(variable.id)
            }}
            aria-label={`Delete ${variable.name}`}>
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Variable editor dialog for environment variables
 */
export function VariableEditorDialog({ open, onOpenChange }: VariableEditorDialogProps) {
  const envVariablesMap = useVarStore((state) => state.environmentVariables)
  const envVariables = React.useMemo(() => Array.from(envVariablesMap.values()), [envVariablesMap])
  const { setEnvironmentVariable, updateEnvironmentVariable, deleteEnvironmentVariable } =
    useVarStore((state) => state.actions)

  const [confirm, ConfirmDialog] = useConfirm()

  const [isEditing, setIsEditing] = useState(false)
  const [editingVariable, setEditingVariable] = useState<EnvVar | null>(null)
  const [formData, setFormData] = useState<VariableFormData>({
    name: '',
    value: '',
    typeValue: { baseType: BaseType.STRING, isArray: false },
  })
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null)
  const [selectedVariableIds, setSelectedVariableIds] = useState<Set<string>>(new Set())
  const [bulkSelectMode, setBulkSelectMode] = useState(false)

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setIsEditing(false)
      setEditingVariable(null)
      setSelectedVariableId(null)
      setSelectedVariableIds(new Set())
      setBulkSelectMode(false)
      const defaultTypeValue = { baseType: BaseType.STRING, isArray: false }
      setFormData({
        name: '',
        value: getDefaultValue(defaultTypeValue),
        typeValue: defaultTypeValue,
      })
    }
  }, [open])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open || isEditing) return

      // Check if user is typing in an input field
      const target = event.target as HTMLElement
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true' ||
        target.getAttribute('role') === 'textbox'

      if (isInputField) return

      if (event.key === 'Delete') {
        event.preventDefault()
        if (bulkSelectMode && selectedVariableIds.size > 0) {
          handleBulkDelete()
        } else if (selectedVariableId) {
          handleDelete(selectedVariableId)
        }
      }

      if (event.key === 'Escape' && bulkSelectMode) {
        event.preventDefault()
        setBulkSelectMode(false)
        setSelectedVariableIds(new Set())
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, isEditing, selectedVariableId, bulkSelectMode, selectedVariableIds])

  const handleEdit = (variable: EnvVar) => {
    setEditingVariable(variable)

    // Convert old type format to VariableTypeValue
    let typeValue: VariableTypeValue
    if (variable.type === 'array') {
      typeValue = { baseType: BaseType.STRING, isArray: true }
    } else if (variable.type === 'secret') {
      typeValue = { baseType: BaseType.SECRET, isArray: false }
    } else if (variable.type === 'number') {
      typeValue = { baseType: BaseType.NUMBER, isArray: false }
    } else if (variable.type === 'boolean') {
      typeValue = { baseType: BaseType.BOOLEAN, isArray: false }
    } else {
      typeValue = { baseType: BaseType.STRING, isArray: false }
    }

    setFormData({
      id: variable.id,
      name: variable.name,
      value: variable.value,
      typeValue,
    })
    setIsEditing(true)
  }

  const handleDelete = async (id: string) => {
    const variable = envVariablesMap.get(id)
    if (!variable) return

    const confirmed = await confirm({
      title: `Delete ${variable.name}?`,
      description: `Are you sure you want to delete the environment variable "${variable.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        deleteEnvironmentVariable(id)
        toastSuccess({
          title: 'Variable deleted',
          description: `Environment variable "${variable.name}" has been deleted successfully.`,
        })
      } catch (error) {
        console.error('Failed to delete environment variable:', error)
        toastError({
          title: 'Delete failed',
          description: 'Failed to delete the environment variable. Please try again.',
        })
      }
    }
  }

  const handleSave = () => {
    if (!formData.name.trim()) {
      toastError({ title: 'Validation error', description: 'Variable name is required.' })
      return
    }

    // Check for duplicate names (only when creating new or changing name)
    const existingVariable = envVariables.find(
      (v) => v.name === formData.name && v.id !== editingVariable?.id
    )
    if (existingVariable) {
      toastError({
        title: 'Validation error',
        description: `A variable with the name "${formData.name}" already exists.`,
      })
      return
    }

    // Convert VariableTypeValue to simple type format for storage
    let simpleType: 'string' | 'number' | 'boolean' | 'array' | 'secret'
    if (formData.typeValue.isArray) {
      simpleType = 'array'
    } else if (formData.typeValue.baseType === BaseType.SECRET) {
      simpleType = 'secret'
    } else if (formData.typeValue.baseType === BaseType.NUMBER) {
      simpleType = 'number'
    } else if (formData.typeValue.baseType === BaseType.BOOLEAN) {
      simpleType = 'boolean'
    } else {
      simpleType = 'string'
    }

    try {
      if (editingVariable) {
        // Update existing variable
        updateEnvironmentVariable(editingVariable.id, {
          name: formData.name,
          value: formData.value,
          type: simpleType,
        })
        toastSuccess({
          title: 'Variable updated',
          description: `Environment variable "${formData.name}" has been updated successfully.`,
        })
      } else {
        // Create new variable
        setEnvironmentVariable({
          name: formData.name,
          value: formData.value,
          type: simpleType,
        })
        toastSuccess({
          title: 'Variable created',
          description: `Environment variable "${formData.name}" has been created successfully.`,
        })
      }

      // Reset form
      setIsEditing(false)
      setEditingVariable(null)
      const defaultTypeValue = { baseType: BaseType.STRING, isArray: false }
      setFormData({
        name: '',
        value: getDefaultValue(defaultTypeValue),
        typeValue: defaultTypeValue,
      })
    } catch (error) {
      console.error('Failed to save environment variable:', error)
      toastError({
        title: 'Save failed',
        description: 'Failed to save the environment variable. Please try again.',
      })
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditingVariable(null)
    const defaultTypeValue = { baseType: BaseType.STRING, isArray: false }
    setFormData({ name: '', value: getDefaultValue(defaultTypeValue), typeValue: defaultTypeValue })
  }

  const handleBulkDelete = async () => {
    if (selectedVariableIds.size === 0) return

    const variableNames = Array.from(selectedVariableIds)
      .map((id) => envVariablesMap.get(id)?.name)
      .filter(Boolean)
      .join(', ')

    const confirmed = await confirm({
      title: `Delete ${selectedVariableIds.size} variable${selectedVariableIds.size > 1 ? 's' : ''}?`,
      description: `Are you sure you want to delete the following environment variable${selectedVariableIds.size > 1 ? 's' : ''}: ${variableNames}? This action cannot be undone.`,
      confirmText: 'Delete All',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        // Delete all selected variables
        selectedVariableIds.forEach((id) => {
          deleteEnvironmentVariable(id)
        })

        toastSuccess({
          title: `${selectedVariableIds.size} variable${selectedVariableIds.size > 1 ? 's' : ''} deleted`,
          description: `Successfully deleted ${selectedVariableIds.size} environment variable${selectedVariableIds.size > 1 ? 's' : ''}.`,
        })

        // Reset selection
        setSelectedVariableIds(new Set())
        setBulkSelectMode(false)
      } catch (error) {
        console.error('Failed to delete environment variables:', error)
        toastError({
          title: 'Bulk delete failed',
          description: 'Failed to delete some environment variables. Please try again.',
        })
      }
    }
  }

  const handleSelectAll = () => {
    if (selectedVariableIds.size === envVariables.length) {
      // Deselect all
      setSelectedVariableIds(new Set())
    } else {
      // Select all
      setSelectedVariableIds(new Set(envVariables.map((v) => v.id)))
    }
  }

  const handleVariableSelect = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedVariableIds)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedVariableIds(newSelected)
  }

  const toggleBulkSelectMode = () => {
    setBulkSelectMode(!bulkSelectMode)
    setSelectedVariableIds(new Set())
  }

  const renderValueInput = () => {
    // Handle array type
    if (formData.typeValue.isArray) {
      return (
        <ArrayValueEditor
          value={formData.value || []}
          onChange={(value) => setFormData({ ...formData, value })}
        />
      )
    }

    // Handle non-array types based on baseType
    switch (formData.typeValue.baseType) {
      case BaseType.NUMBER:
        return (
          <Input
            type='number'
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: Number(e.target.value) })}
            placeholder='Enter number'
          />
        )

      case BaseType.BOOLEAN:
        return (
          <div className='flex items-center space-x-2'>
            <Switch
              checked={formData.value}
              onCheckedChange={(checked) => setFormData({ ...formData, value: checked })}
            />
            <Label className='text-sm'>{formData.value ? 'True' : 'False'}</Label>
          </div>
        )

      case BaseType.SECRET:
        return (
          <Input
            type='password'
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            placeholder='Enter secret value'
          />
        )

      default:
        return (
          <Input
            value={formData.value}
            onChange={(e) => setFormData({ ...formData, value: e.target.value })}
            placeholder='Enter value'
          />
        )
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-h-[80vh]' position='tc' size='md'>
          <DialogHeader>
            <DialogTitle>Environment Variables</DialogTitle>
            <DialogDescription>
              Manage environment variables for your workflow. Use 'Select Multiple' for bulk
              operations, or select individual variables and press Delete to remove them.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-4'>
            {/* Variable List */}
            <div className='space-y-3'>
              <div className='flex items-center justify-between'>
                {bulkSelectMode ? (
                  <div className='flex items-center gap-3'>
                    <Checkbox
                      checked={
                        selectedVariableIds.size === envVariables.length && envVariables.length > 0
                      }
                      onCheckedChange={handleSelectAll}
                      aria-label='Select all variables'
                    />
                    <span className='text-sm font-medium'>
                      {selectedVariableIds.size > 0
                        ? `${selectedVariableIds.size} of ${envVariables.length} selected`
                        : 'Select all variables'}
                    </span>
                  </div>
                ) : (
                  <Label className='text-sm font-medium'>Variables</Label>
                )}
                <div className='flex items-center gap-2'>
                  {envVariables.length > 0 && (
                    <Button
                      variant={bulkSelectMode ? 'default' : 'outline'}
                      size='xs'
                      onClick={toggleBulkSelectMode}>
                      <Check />
                      {bulkSelectMode ? 'Cancel Selection' : 'Select Multiple'}
                    </Button>
                  )}

                  {bulkSelectMode ? (
                    selectedVariableIds.size > 0 && (
                      <Button variant='destructive' size='xs' onClick={handleBulkDelete}>
                        <Trash2 />
                        Delete Selected ({selectedVariableIds.size})
                      </Button>
                    )
                  ) : (
                    <Button
                      variant='outline'
                      size='xs'
                      onClick={() => setIsEditing(true)}
                      disabled={isEditing}>
                      <Plus />
                      Add Variable
                    </Button>
                  )}
                </div>
              </div>

              {/* Bulk Actions Bar */}

              {envVariables.length === 0 ? (
                <div className='h-[200px]'>
                  <Empty className='border border-primary-300'>
                    <EmptyHeader className='gap-0'>
                      <EmptyMedia variant='icon' className='bg-primary-100'>
                        <Variable />
                      </EmptyMedia>
                      <EmptyTitle>No env variables</EmptyTitle>
                      <EmptyDescription>Create a new variable to get started.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </div>
              ) : (
                <ScrollArea className='h-[200px] border rounded-lg p-2'>
                  <div className='space-y-2'>
                    {envVariables.map((variable) => (
                      <VariableItem
                        key={variable.id}
                        variable={variable}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        isSelected={selectedVariableId === variable.id}
                        onSelect={setSelectedVariableId}
                        bulkSelectMode={bulkSelectMode}
                        isChecked={selectedVariableIds.has(variable.id)}
                        onCheck={handleVariableSelect}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Edit Form */}
            {isEditing && (
              <div className='space-y-2 border rounded-lg p-2 bg-primary-100 '>
                <div className='flex items-center justify-between'>
                  <Label className='text-sm font-medium'>
                    {editingVariable ? 'Edit Variable' : 'Add Variable'}
                  </Label>
                  <Button variant='ghost' size='icon' onClick={handleCancel} className='h-6 w-6'>
                    <X />
                  </Button>
                </div>

                <div className='relative'>
                  <Input
                    id='var-name'
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder='VARIABLE_NAME'
                  />
                  <div className='absolute right-1 top-1/2 -translate-y-1/2'>
                    <VariableTypePicker
                      value={formData.typeValue}
                      onChange={(newTypeValue) => {
                        const newValue = getDefaultValue(newTypeValue)
                        setFormData({ ...formData, typeValue: newTypeValue, value: newValue })
                      }}
                      compact
                      popoverWidth={320}
                      align='end'
                      excludeTypes={[
                        BaseType.DATE,
                        BaseType.DATETIME,
                        BaseType.TIME,
                        BaseType.FILE,
                        BaseType.REFERENCE,
                        BaseType.EMAIL,
                        BaseType.URL,
                        BaseType.PHONE,
                        BaseType.ENUM,
                        BaseType.JSON,
                        BaseType.RELATION,
                        BaseType.OBJECT,
                        BaseType.ANY,
                      ]}
                    />
                  </div>
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='var-value'>Value</Label>
                  {renderValueInput()}
                </div>

                <div className='flex gap-2 flex-row justify-end'>
                  <Button variant='ghost' onClick={handleCancel} size='sm'>
                    Cancel
                  </Button>

                  <Button onClick={handleSave} size='sm' variant='outline'>
                    {editingVariable ? 'Update' : 'Create'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
