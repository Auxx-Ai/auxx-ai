// apps/web/src/components/workflow/ui/structured-output-generator/visual-editor/edit-card/index.tsx

import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Separator } from '@auxx/ui/components/separator'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SchemaEnumType } from '../../types'
import { ArrayType, JSON_SCHEMA_MAX_DEPTH, Type } from '../../types'
import { useEventEmitter } from '../context'
import { useVisualEditorStore } from '../store'
import Actions from './actions'
import AdvancedActions from './advanced-actions'
import AdvancedOptions, { type AdvancedOptionsType } from './advanced-options'
import type { TypeItem } from './type-selector'
import TypeSelector from './type-selector'

export type EditData = {
  name: string
  type: Type | ArrayType
  required: boolean
  description?: string
  enum?: SchemaEnumType
}

type Options = { description?: string; enum?: SchemaEnumType }

type EditCardProps = { fields: EditData; depth: number; path: string[]; parentPath: string[] }

const TYPE_OPTIONS = [
  { value: Type.string, text: 'string' },
  { value: Type.number, text: 'number' },
  // { value: Type.boolean, text: 'boolean' },
  { value: Type.object, text: 'object' },
]

const MAXIMUM_DEPTH_TYPE_OPTIONS = [
  { value: Type.string, text: 'string' },
  { value: Type.number, text: 'number' },
  // { value: Type.boolean, text: 'boolean' },
]

// Helper function to check if a type is an array type
const isArrayType = (type: Type | ArrayType): boolean => {
  return type === ArrayType.string || type === ArrayType.number || type === ArrayType.object
}

// Helper function to get base type from array type
const getBaseType = (type: Type | ArrayType): Type => {
  switch (type) {
    case ArrayType.string:
      return Type.string
    case ArrayType.number:
      return Type.number
    case ArrayType.object:
      return Type.object
    default:
      return type as Type
  }
}

// Helper function to convert base type to array type
const toArrayType = (type: Type): ArrayType | null => {
  switch (type) {
    case Type.string:
      return ArrayType.string
    case Type.number:
      return ArrayType.number
    case Type.object:
      return ArrayType.object
    default:
      return null
  }
}

const EditCard: FC<EditCardProps> = ({ fields, depth, path, parentPath }) => {
  const [currentFields, setCurrentFields] = useState(fields)
  const [backupFields, setBackupFields] = useState<EditData | null>(null)
  const [isArray, setIsArray] = useState(() => isArrayType(fields.type))
  const isAddingNewField = useVisualEditorStore((state) => state.isAddingNewField)
  const setIsAddingNewField = useVisualEditorStore((state) => state.setIsAddingNewField)
  const advancedEditing = useVisualEditorStore((state) => state.advancedEditing)
  const setAdvancedEditing = useVisualEditorStore((state) => state.setAdvancedEditing)
  const setIsActivelyEditing = useVisualEditorStore((state) => state.setIsActivelyEditing)
  const setFocusedFieldPath = useVisualEditorStore((state) => state.setFocusedFieldPath)
  const { emit, useSubscribe } = useEventEmitter()
  const blurWithActions = useRef(false)
  // Use refs to maintain editing state across renders
  const isEditingRef = useRef(false)
  const lastPropsRef = useRef(fields)
  const nameInputRef = useRef<AutosizeInputRef>(null)
  const descriptionInputRef = useRef<HTMLInputElement>(null)
  const currentFieldsRef = useRef(currentFields)

  const isAdvancedEditing = advancedEditing || isAddingNewField

  // Keep ref in sync with state
  useEffect(() => {
    currentFieldsRef.current = currentFields
  }, [currentFields])

  // Sync state with props only when props actually change and user is not editing
  useEffect(() => {
    // Skip updates if actively editing or if props haven't actually changed
    if (isEditingRef.current || isAdvancedEditing) {
      return
    }

    // Check if props have actually changed
    const propsChanged = JSON.stringify(fields) !== JSON.stringify(lastPropsRef.current)
    if (propsChanged) {
      lastPropsRef.current = fields
      setCurrentFields(fields)
      setIsArray(isArrayType(fields.type))
    }
  }, [fields, isAdvancedEditing])

  const maximumDepthReached = depth === JSON_SCHEMA_MAX_DEPTH
  const disableAddBtn =
    maximumDepthReached ||
    (currentFields.type !== Type.object && currentFields.type !== ArrayType.object)
  const hasAdvancedOptions =
    currentFields.type === Type.string ||
    currentFields.type === Type.number ||
    currentFields.type === ArrayType.string ||
    currentFields.type === ArrayType.number

  const advancedOptions = useMemo(() => {
    let enumValue = ''
    const baseType = getBaseType(currentFields.type)
    if (baseType === Type.string || baseType === Type.number)
      enumValue = (currentFields.enum || []).join(', ')
    return { enum: enumValue }
  }, [currentFields.type, currentFields.enum])

  const handleRestorePropertyName = useCallback(() => {
    setCurrentFields((prev) => ({ ...prev, name: fields.name }))
  }, [fields.name])

  const handleFieldChangeSuccess = useCallback(() => {
    if (isAddingNewField) setIsAddingNewField(false)
    if (advancedEditing) setAdvancedEditing(false)
  }, [isAddingNewField, setIsAddingNewField, advancedEditing, setAdvancedEditing])

  useSubscribe('restorePropertyName', handleRestorePropertyName)
  useSubscribe('fieldChangeSuccess', handleFieldChangeSuccess)

  const emitPropertyNameChange = useCallback(() => {
    emit('propertyNameChange', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [fields, currentFields, path, parentPath, emit])

  const emitPropertyTypeChange = useCallback(
    (type: Type | ArrayType) => {
      emit('propertyTypeChange', {
        path,
        parentPath,
        oldFields: fields,
        fields: { ...currentFields, type },
      })
    },
    [fields, currentFields, path, parentPath, emit]
  )

  const emitPropertyOptionsChange = useCallback(
    (options: Options) => {
      emit('propertyOptionsChange', {
        path,
        parentPath,
        oldFields: fields,
        fields: { ...currentFields, ...options },
      })
    },
    [emit, path, parentPath, fields, currentFields]
  )

  const emitPropertyDelete = useCallback(() => {
    emit('propertyDelete', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [emit, path, parentPath, fields, currentFields])

  const emitPropertyAdd = useCallback(() => {
    emit('addField', { path })
  }, [emit, path])

  const handlePropertyNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      isEditingRef.current = true
      setIsActivelyEditing(true)
      setCurrentFields((prev) => ({ ...prev, name: e.target.value }))
    },
    [setIsActivelyEditing]
  )

  const handlePropertyNameBlur = useCallback(() => {
    isEditingRef.current = false
    setIsActivelyEditing(false)
    setFocusedFieldPath(null)
    if (isAdvancedEditing) return
    emitPropertyNameChange()
  }, [isAdvancedEditing, emitPropertyNameChange, setIsActivelyEditing, setFocusedFieldPath])

  const handleTypeChange = useCallback(
    (item: TypeItem) => {
      const baseType = item.value as Type
      const newType = isArray && toArrayType(baseType) ? toArrayType(baseType)! : baseType
      setCurrentFields((prev) => ({ ...prev, type: newType }))
      if (isAdvancedEditing) return
      emitPropertyTypeChange(newType)
    },
    [isArray, isAdvancedEditing, emitPropertyTypeChange]
  )

  const handleArrayToggle = useCallback(
    (checked: boolean) => {
      setIsArray(checked)
      const baseType = getBaseType(currentFields.type)
      const newType = checked && toArrayType(baseType) ? toArrayType(baseType)! : baseType
      setCurrentFields((prev) => ({ ...prev, type: newType }))
      if (isAdvancedEditing) return
      emitPropertyTypeChange(newType)
    },
    [currentFields.type, isAdvancedEditing, emitPropertyTypeChange]
  )

  const toggleRequired = useCallback(
    (checked: boolean) => {
      // Prevent unnecessary updates
      if (currentFields.required === checked) {
        return
      }

      const newFields = { ...currentFields, required: checked }
      setCurrentFields(newFields)

      // Emit event after state update, not during render
      if (!isAdvancedEditing) {
        // Use setTimeout to defer the emission to after the current render cycle
        setTimeout(() => {
          emit('propertyRequiredToggle', { path, parentPath, oldFields: fields, fields: newFields })
        }, 0)
      }
    },
    [currentFields, isAdvancedEditing, emit, path, parentPath, fields]
  )

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      isEditingRef.current = true
      setIsActivelyEditing(true)
      setCurrentFields((prev) => ({ ...prev, description: e.target.value }))
    },
    [setIsActivelyEditing]
  )

  const handleDescriptionBlur = useCallback(() => {
    isEditingRef.current = false
    setIsActivelyEditing(false)
    setFocusedFieldPath(null)
    if (isAdvancedEditing) return
    emitPropertyOptionsChange({ description: currentFields.description, enum: currentFields.enum })
  }, [
    isAdvancedEditing,
    emitPropertyOptionsChange,
    currentFields,
    setIsActivelyEditing,
    setFocusedFieldPath,
  ])

  const handleAdvancedOptionsChange = useCallback(
    (options: AdvancedOptionsType) => {
      let enumValue: any = options.enum
      if (enumValue === '') {
        enumValue = undefined
      } else {
        enumValue = options.enum.replace(/\s/g, '').split(',')
        const baseType = getBaseType(currentFields.type)
        if (baseType === Type.number)
          enumValue = (enumValue as SchemaEnumType)
            .map((value) => Number(value))
            .filter((num) => !Number.isNaN(num))
      }
      const newFields = { ...currentFields, enum: enumValue }
      setCurrentFields(newFields)

      if (!isAdvancedEditing) {
        emitPropertyOptionsChange({ description: newFields.description, enum: enumValue })
      }
    },
    [currentFields, isAdvancedEditing, emitPropertyOptionsChange]
  )

  const handleDelete = useCallback(() => {
    blurWithActions.current = true
    emitPropertyDelete()
  }, [emitPropertyDelete])

  const handleAdvancedEdit = useCallback(() => {
    setBackupFields({ ...currentFields })
    setAdvancedEditing(true)
  }, [currentFields, setAdvancedEditing])

  const handleAddChildField = useCallback(() => {
    blurWithActions.current = true
    emitPropertyAdd()
  }, [emitPropertyAdd])

  const handleConfirm = useCallback(() => {
    emit('fieldChange', { path, parentPath, oldFields: fields, fields: currentFields })
  }, [emit, path, parentPath, fields, currentFields])

  const handleCancel = useCallback(() => {
    if (isAddingNewField) {
      blurWithActions.current = true
      emit('restoreSchema')
      setIsAddingNewField(false)
      return
    }
    if (backupFields) {
      setCurrentFields(backupFields)
      setIsArray(isArrayType(backupFields.type))
      setBackupFields(null)
    }
    setAdvancedEditing(false)
  }, [isAddingNewField, emit, setIsAddingNewField, setAdvancedEditing, backupFields])

  // Cleanup effect to save changes when component unmounts while editing
  useEffect(() => {
    return () => {
      // Only save if we're actively editing and have unsaved changes
      if (isEditingRef.current && !blurWithActions.current) {
        const current = currentFieldsRef.current
        const hasNameChanged = fields.name !== current.name
        const hasDescriptionChanged = fields.description !== current.description

        if (hasNameChanged) {
          emit('propertyNameChange', { path, parentPath, oldFields: fields, fields: current })
        }
        if (hasDescriptionChanged) {
          emit('propertyOptionsChange', {
            path,
            parentPath,
            oldFields: fields,
            fields: { ...current, description: current.description, enum: current.enum },
          })
        }

        // Clear focused field path
        setFocusedFieldPath(null)
      }
    }
  }, [fields, path, parentPath, emit, setFocusedFieldPath]) // Dependencies for cleanup

  return (
    <div className='flex flex-col rounded-lg bg-background py-0.5 shadow-sm'>
      <div className='flex h-7 items-center pl-1 pr-0.5'>
        <div className='flex grow items-center gap-x-1'>
          <AutosizeInput
            ref={nameInputRef}
            value={currentFields.name}
            placeholder='Field name'
            minWidth={80}
            maxWidth={300}
            onChange={handlePropertyNameChange}
            onFocus={() => {
              isEditingRef.current = true
              setIsActivelyEditing(true)
              setFocusedFieldPath(path.join('.'))
            }}
            onBlur={handlePropertyNameBlur}
            inputClassName='font-semibold text-sm h-5 rounded-[5px] border border-transparent px-1 py-px text-primary-500 caret-[#295EFF] outline-none placeholder:text-primary-400 hover:bg-state-base-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'
          />
          <TypeSelector
            currentValue={getBaseType(currentFields.type)}
            items={maximumDepthReached ? MAXIMUM_DEPTH_TYPE_OPTIONS : TYPE_OPTIONS}
            onSelect={handleTypeChange}
            popupClassName='z-[1000]'
          />
          {/* Array toggle switch */}
          <div className='flex items-center gap-x-1 rounded-[5px] border border-divider-subtle px-1.5 py-1'>
            <span className='uppercase text-[10px] font-normal'>Array</span>
            <Switch size='sm' checked={isArray} onCheckedChange={handleArrayToggle} />
          </div>
          {currentFields.required && (
            <div className='text-[10px] uppercase font-normal px-1 py-0.5 text-bad-500'>
              Required
            </div>
          )}
        </div>
        <div className='flex items-center gap-x-1 rounded-[5px] border border-divider-subtle px-1.5 py-1'>
          <span className='uppercase text-[10px] font-normal'>Required</span>
          <Switch size='sm' checked={!!currentFields.required} onCheckedChange={toggleRequired} />
        </div>
        <Separator orientation='vertical' className='h-3' />
        {isAdvancedEditing ? (
          <AdvancedActions
            isConfirmDisabled={currentFields.name === ''}
            onCancel={handleCancel}
            onConfirm={handleConfirm}
          />
        ) : (
          <Actions
            disableAddBtn={disableAddBtn}
            onAddChildField={handleAddChildField}
            onDelete={handleDelete}
            onEdit={handleAdvancedEdit}
          />
        )}
      </div>

      {(fields.description || isAdvancedEditing) && (
        <div className={cn('flex', isAdvancedEditing ? 'p-2 pt-1' : 'px-2 pb-1')}>
          <input
            ref={descriptionInputRef}
            value={currentFields.description || ''}
            className='text-xs h-4 w-full p-0 text-primary-500 caret-[#295EFF] outline-none placeholder:text-primary-400'
            placeholder='Description'
            onChange={handleDescriptionChange}
            onFocus={() => {
              isEditingRef.current = true
              setIsActivelyEditing(true)
              setFocusedFieldPath(path.join('.'))
            }}
            onBlur={handleDescriptionBlur}
            onKeyUp={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
      )}

      {isAdvancedEditing && hasAdvancedOptions && (
        <AdvancedOptions options={advancedOptions} onChange={handleAdvancedOptionsChange} />
      )}
    </div>
  )
}

export default React.memo(EditCard, (prevProps, nextProps) => {
  // Custom comparison to prevent re-renders during editing
  // Only re-render if depth, path, or parentPath changes
  return (
    prevProps.depth === nextProps.depth &&
    JSON.stringify(prevProps.path) === JSON.stringify(nextProps.path) &&
    JSON.stringify(prevProps.parentPath) === JSON.stringify(nextProps.parentPath)
  )
})
