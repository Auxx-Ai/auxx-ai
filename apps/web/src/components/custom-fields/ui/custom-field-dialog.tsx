// apps/web/src/components/custom-fields/ui/custom-field-dialog.tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { ChevronDown } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Switch } from '@auxx/ui/components/switch'
import { Button } from '@auxx/ui/components/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from '@auxx/ui/components/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { FieldGroup, Field, FieldLabel } from '@auxx/ui/components/field'

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import {
  customFieldFormSchema,
  type CustomFieldFormValues,
  fieldTypeOptions,
  FIELD_TYPE_GROUPS,
} from '@auxx/lib/custom-fields/types'
import { canFieldBeUnique, type SelectOptionColor } from '@auxx/types/custom-field'
import { EntityIcon } from '@auxx/ui/components/icons'

import {
  OptionsEditor,
  parseSelectOptions,
  formatSelectOptions,
  type SelectOption,
} from './options-editor'
import {
  AddressComponentsEditor,
  parseAddressComponents,
  formatAddressComponents,
} from './address-component-editor'
import {
  FileOptionsEditor,
  parseFileOptions,
  formatFileOptions,
  type FileOptions,
} from './file-options-editor'
import { RelationshipFieldEditor, type RelationshipOptions } from './relationship-field-editor'
import {
  CurrencyOptionsEditor,
  parseCurrencyOptions,
  formatCurrencyOptions,
  type CurrencyOptions,
} from './currency-options-editor'
import {
  NumberFormattingEditor,
  DateFormattingEditor,
  DateTimeFormattingEditor,
  TimeFormattingEditor,
  BooleanFormattingEditor,
  PhoneFormattingEditor,
  parseDisplayOptions,
  formatDisplayOptions,
  type DisplayOptions,
} from './formatting-editors'
import {
  CalcFieldEditor,
  parseCalcOptions,
  formatCalcOptions,
  type CalcEditorOptions,
} from './calc-editor'
import {
  ActorOptionsEditor,
  getDefaultActorOptions,
  parseActorOptions,
  formatActorOptions,
  type ActorFieldOptions,
} from './actor-options-editor'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { useField, useResourceFields } from '~/components/resources'
import { toastError } from '@auxx/ui/components/toast'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'

/** Field types that don't support default values */
const TYPES_WITHOUT_DEFAULT_VALUE: FieldTypeType[] = [
  FieldType.ADDRESS_STRUCT,
  FieldType.FILE,
  FieldType.RELATIONSHIP,
  FieldType.CURRENCY,
  FieldType.CALC,
  FieldType.ACTOR,
]

/** Field types that don't support required validation */
const TYPES_WITHOUT_REQUIRED: FieldTypeType[] = [FieldType.CALC]

/** Props for CustomFieldDialog */
interface CustomFieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ResourceFieldId for edit mode (replaces editingField), null/undefined for create mode */
  resourceFieldId?: ResourceFieldId | null
  /** Entity definition ID - required for creating fields. For edit mode, derived from resourceFieldId if not provided */
  entityDefinitionId?: string
  /** Called after successful save - receives the created/updated field */
  onSuccess?: (field: { id: string; name: string }) => void
}

/**
 * Unified dialog for creating and editing custom fields
 * - Create mode: shows field type dropdown
 * - Edit mode: hides field type (cannot be changed)
 */
export function CustomFieldDialog({
  open,
  onOpenChange,
  resourceFieldId,
  entityDefinitionId: entityDefinitionIdProp,
  onSuccess,
}: CustomFieldDialogProps) {
  // Fetch field from store using useField hook
  const editingField = useField(resourceFieldId)
  const isEditing = !!resourceFieldId

  // Derive entityDefinitionId from resourceFieldId if in edit mode
  const effectiveEntityDefId = useMemo(() => {
    if (resourceFieldId) {
      const { entityDefinitionId: parsedId } = parseResourceFieldId(resourceFieldId)
      return parsedId
    }
    return entityDefinitionIdProp ?? ''
  }, [resourceFieldId, entityDefinitionIdProp])

  // Handle case where field is not found when editing
  useEffect(() => {
    if (open && resourceFieldId && !editingField) {
      toastError({
        title: 'Field not found',
        description: 'The field may have been deleted.',
      })
      onOpenChange(false)
    }
  }, [open, resourceFieldId, editingField, onOpenChange])

  // Use custom field mutations hook for create/update
  const { create, update, isPending } = useCustomFieldMutations({
    entityDefinitionId: effectiveEntityDefId,
  })

  // Form setup
  const form = useForm<CustomFieldFormValues>({
    resolver: standardSchemaResolver(customFieldFormSchema),
    defaultValues: {
      name: '',
      type: FieldType.TEXT,
      fieldType: FieldType.TEXT,
      description: '',
      required: false,
      isUnique: false,
      defaultValue: '',
      icon: '',
      isCustom: true,
    },
  })

  // States for complex field options (use parse helpers for defaults)
  const [selectOptions, setSelectOptions] = useState<SelectOption[]>([])
  const [addressComponents, setAddressComponents] = useState<string[]>(parseAddressComponents())
  const [fileOptions, setFileOptions] = useState<FileOptions>(parseFileOptions())
  const [relationshipOptions, setRelationshipOptions] = useState<RelationshipOptions>({
    relatedResourceId: 'contact',
    relationshipType: 'belongs_to',
    inverseName: '',
  })
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOptions>(parseCurrencyOptions())
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({})
  const [showDisplayOptions, setShowDisplayOptions] = useState(false)
  const [calcOptions, setCalcOptions] = useState<CalcEditorOptions>(parseCalcOptions())
  const [actorOptions, setActorOptions] = useState<ActorFieldOptions>(getDefaultActorOptions())
  // State for inverse field name in edit mode
  const [inverseName, setInverseName] = useState('')

  // Fetch inverse field for edit mode to get initial label
  const inverseResourceFieldId = editingField?.options?.relationship?.inverseResourceFieldId
  const inverseField = useField(isEditing ? inverseResourceFieldId : null)

  // Fetch available fields for CALC editor (exclude the current field being edited and other CALC fields)
  const { fields: resourceFields } = useResourceFields(effectiveEntityDefId)
  const calcAvailableFields = useMemo(() => {
    return resourceFields
      .filter((f) => {
        // Exclude the field being edited
        if (editingField && f.id === editingField.id) return false
        // Exclude other CALC fields to prevent circular references
        if (f.fieldType === FieldType.CALC) return false
        return true
      })
      .map((f) => ({
        id: f.id,
        key: f.key || f.id,
        label: f.label,
        type: f.fieldType ?? 'TEXT',
      }))
  }, [resourceFields, editingField])

  // Track initial values for extra state (not managed by react-hook-form)
  const [initialExtraState, setInitialExtraState] = useState<{
    selectOptions: SelectOption[]
    addressComponents: string[]
    fileOptions: FileOptions
    relationshipOptions: RelationshipOptions
    currencyOptions: CurrencyOptions
    displayOptions: DisplayOptions
    calcOptions: CalcEditorOptions
    actorOptions: ActorFieldOptions
    inverseName: string
  } | null>(null)

  // Check if extra state (outside react-hook-form) has changed
  const isExtraStateDirty = useMemo(() => {
    if (!initialExtraState) return false
    const selectOptionsChanged =
      JSON.stringify(selectOptions) !== JSON.stringify(initialExtraState.selectOptions)
    const addressChanged =
      JSON.stringify(addressComponents) !== JSON.stringify(initialExtraState.addressComponents)
    const fileChanged =
      JSON.stringify(fileOptions) !== JSON.stringify(initialExtraState.fileOptions)
    const relationshipChanged =
      JSON.stringify(relationshipOptions) !== JSON.stringify(initialExtraState.relationshipOptions)
    const currencyChanged =
      JSON.stringify(currencyOptions) !== JSON.stringify(initialExtraState.currencyOptions)
    const displayOptionsChanged =
      JSON.stringify(displayOptions) !== JSON.stringify(initialExtraState.displayOptions)
    const calcOptionsChanged =
      JSON.stringify(calcOptions) !== JSON.stringify(initialExtraState.calcOptions)
    const actorOptionsChanged =
      JSON.stringify(actorOptions) !== JSON.stringify(initialExtraState.actorOptions)
    const inverseNameChanged = inverseName !== initialExtraState.inverseName
    return (
      selectOptionsChanged ||
      addressChanged ||
      fileChanged ||
      relationshipChanged ||
      currencyChanged ||
      displayOptionsChanged ||
      calcOptionsChanged ||
      actorOptionsChanged ||
      inverseNameChanged
    )
  }, [
    selectOptions,
    addressComponents,
    fileOptions,
    relationshipOptions,
    currencyOptions,
    displayOptions,
    calcOptions,
    actorOptions,
    inverseName,
    initialExtraState,
  ])

  // Combined dirty state: form fields OR extra state changed
  const isDirty = form.formState.isDirty || isExtraStateDirty

  // Stable callback for closing the dialog
  const handleConfirmedClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Guard against accidental close when dirty
  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: handleConfirmedClose,
  })

  // Reset form when dialog opens or editing field changes
  useEffect(() => {
    if (open) {
      // Use parse helpers for defaults
      let initSelectOptions: SelectOption[] = []
      let initAddressComponents: string[] = parseAddressComponents()
      let initFileOptions: FileOptions = parseFileOptions()
      let initRelationshipOptions: RelationshipOptions = {
        relatedResourceId: 'contact',
        relationshipType: 'belongs_to',
        inverseName: '',
      }
      let initCurrencyOptions: CurrencyOptions = parseCurrencyOptions()
      let initDisplayOptions: DisplayOptions = {}
      let initCalcOptions: CalcEditorOptions = parseCalcOptions()
      let initActorOptions: ActorFieldOptions = getDefaultActorOptions()
      let initInverseName = ''

      if (editingField) {
        // Edit mode: populate form with existing field data from ResourceField
        const fieldType = (editingField.fieldType as FieldTypeType) || FieldType.TEXT
        form.reset({
          name: editingField.label || '',
          type: fieldType,
          fieldType: fieldType,
          description: editingField.description || '',
          required: editingField.required || false,
          isUnique: editingField.isUnique || false,
          defaultValue: editingField.defaultValue || '',
          icon: editingField.options?.icon || '',
          isCustom: !editingField.isSystem,
        })

        // Parse complex options using helper functions
        initSelectOptions = parseSelectOptions(editingField.options as FieldOptions)
        setSelectOptions(initSelectOptions)

        initAddressComponents = parseAddressComponents(editingField.options as FieldOptions)
        setAddressComponents(initAddressComponents)

        initFileOptions = parseFileOptions(editingField.options as FieldOptions)
        setFileOptions(initFileOptions)

        // Relationship options: keep create options for create mode only
        // In edit mode, we don't populate relationshipOptions since the editor uses storedConfig
        setRelationshipOptions(initRelationshipOptions)

        initCurrencyOptions = parseCurrencyOptions(editingField.options as FieldOptions)
        setCurrencyOptions(initCurrencyOptions)

        initDisplayOptions = parseDisplayOptions(editingField.options as FieldOptions)
        setDisplayOptions(initDisplayOptions)
        setShowDisplayOptions(false)

        initCalcOptions = parseCalcOptions(editingField.options as Record<string, unknown>)
        setCalcOptions(initCalcOptions)

        initActorOptions = parseActorOptions(editingField.options as FieldOptions)
        setActorOptions(initActorOptions)

        // Initialize inverse name from inverse field (will update when inverseField loads)
        initInverseName = inverseField?.label ?? ''
        setInverseName(initInverseName)
      } else {
        // Create mode: reset to defaults
        form.reset({
          name: '',
          type: FieldType.TEXT,
          fieldType: FieldType.TEXT,
          description: '',
          required: false,
          isUnique: false,
          defaultValue: '',
          icon: '',
          isCustom: true,
        })
        setSelectOptions(initSelectOptions)
        setAddressComponents(initAddressComponents)
        setFileOptions(initFileOptions)
        setRelationshipOptions(initRelationshipOptions)
        setCurrencyOptions(initCurrencyOptions)
        setDisplayOptions(initDisplayOptions)
        setShowDisplayOptions(false)
        setCalcOptions(initCalcOptions)
        setActorOptions(initActorOptions)
        setInverseName(initInverseName)
      }

      // Set baseline for dirty checking
      setInitialExtraState({
        selectOptions: initSelectOptions,
        addressComponents: initAddressComponents,
        fileOptions: initFileOptions,
        relationshipOptions: initRelationshipOptions,
        currencyOptions: initCurrencyOptions,
        displayOptions: initDisplayOptions,
        calcOptions: initCalcOptions,
        actorOptions: initActorOptions,
        inverseName: initInverseName,
      })
    }
  }, [open, resourceFieldId, editingField, form, inverseField?.label])

  // Watch selected type
  const selectedType = form.watch('type')

  // Get selected field type option for display
  const selectedTypeOption = fieldTypeOptions[selectedType]

  // Clear default value, reset isUnique, and reset displayOptions when type changes (in create mode only)
  useEffect(() => {
    if (!isEditing) {
      form.setValue('defaultValue', '')
      // Reset isUnique if new type doesn't support uniqueness
      if (!canFieldBeUnique(selectedType, relationshipOptions.relationshipType)) {
        form.setValue('isUnique', false)
      }
      // Reset displayOptions and close panel when type changes
      setDisplayOptions({})
      setShowDisplayOptions(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, isEditing])

  /** Handle form submission */
  const handleSubmit = async (values: CustomFieldFormValues) => {
    const submitObj: any = {
      ...values,
      entityDefinitionId: effectiveEntityDefId,
    }

    // Add type-specific options using format helpers
    if (values.type === FieldType.SINGLE_SELECT || values.type === FieldType.MULTI_SELECT) {
      submitObj.options = selectOptions
    }

    if (values.type === FieldType.ADDRESS_STRUCT) {
      submitObj.addressComponents = addressComponents
    }

    if (values.type === FieldType.FILE) {
      submitObj.options = formatFileOptions(fileOptions)
    }

    if (values.type === FieldType.RELATIONSHIP) {
      if (!isEditing) {
        // Create mode: pass relationship options
        submitObj.relationship = relationshipOptions
      } else {
        // Edit mode: include inverse name for updating the inverse field
        submitObj.inverseName = inverseName
      }
    }

    if (values.type === FieldType.CURRENCY) {
      submitObj.options = formatCurrencyOptions(currencyOptions)
    }

    if (values.type === FieldType.CALC) {
      console.log('[CustomFieldDialog] calcOptions on submit:', calcOptions)
      submitObj.options = formatCalcOptions(calcOptions)
      console.log('[CustomFieldDialog] formatted options:', submitObj.options)
    }

    if (values.type === FieldType.ACTOR) {
      submitObj.options = formatActorOptions(actorOptions)
    }

    // Merge display options using format helper
    const formattedDisplayOptions = formatDisplayOptions(displayOptions)
    if (Object.keys(formattedDisplayOptions).length > 0) {
      submitObj.options = { ...submitObj.options, ...formattedDisplayOptions }
    }

    try {
      let resultField: { id: string; name: string }

      if (isEditing && resourceFieldId && editingField?.id) {
        // Update existing field - use resourceFieldId directly
        await update.mutateAsync({
          ...submitObj,
          resourceFieldId,
        })
        resultField = { id: editingField.id, name: values.name }
      } else {
        // Create new field
        const newField = await create.mutateAsync(submitObj)
        resultField = { id: newField.id, name: newField.name }
      }

      onOpenChange(false)
      onSuccess?.(resultField)
    } catch (error) {
      // Error toast already handled by useCustomFieldMutations
      console.error('Failed to save field:', error)
    }
  }

  /** Render type-specific editors */
  const renderTypeSpecificEditors = () => {
    switch (selectedType) {
      case FieldType.SINGLE_SELECT:
      case FieldType.MULTI_SELECT:
        return <OptionsEditor options={selectOptions} onChange={setSelectOptions} />
      case FieldType.ADDRESS_STRUCT:
        return (
          <AddressComponentsEditor components={addressComponents} onChange={setAddressComponents} />
        )
      case FieldType.FILE:
        return <FileOptionsEditor options={fileOptions} onChange={setFileOptions} />
      case FieldType.RELATIONSHIP:
        // Pass different props based on create vs edit mode
        if (isEditing && editingField?.options?.relationship) {
          return (
            <RelationshipFieldEditor
              mode="edit"
              storedConfig={editingField.options.relationship as RelationshipConfig}
              entityDefinitionId={effectiveEntityDefId}
              name={form.watch('name')}
              onNameChange={(v) => form.setValue('name', v)}
              inverseName={inverseName}
              onInverseNameChange={setInverseName}
            />
          )
        }
        return (
          <RelationshipFieldEditor
            mode="create"
            options={relationshipOptions}
            onChange={setRelationshipOptions}
            entityDefinitionId={effectiveEntityDefId}
            name={form.watch('name')}
            onNameChange={(v) => form.setValue('name', v)}
          />
        )
      case FieldType.CURRENCY:
        return <CurrencyOptionsEditor options={currencyOptions} onChange={setCurrencyOptions} />
      case FieldType.CALC:
        return (
          <CalcFieldEditor
            options={calcOptions}
            onChange={setCalcOptions}
            entityDefinitionId={effectiveEntityDefId}
            currentFieldId={editingField?.id}
            availableFields={calcAvailableFields}
          />
        )
      case FieldType.ACTOR:
        return (
          <ActorOptionsEditor
            options={actorOptions}
            onChange={setActorOptions}
            mode={isEditing ? 'edit' : 'create'}
          />
        )
      default:
        return null
    }
  }

  /** Check if field type supports display options */
  const supportsDisplayOptions = (type: FieldTypeType): boolean => {
    return [
      FieldType.NUMBER,
      FieldType.DATE,
      FieldType.DATETIME,
      FieldType.TIME,
      FieldType.CHECKBOX,
      FieldType.PHONE_INTL,
    ].includes(type)
  }

  /** Render the actual display options editor content */
  const renderDisplayOptionsContent = () => {
    switch (selectedType) {
      case FieldType.NUMBER:
        return <NumberFormattingEditor options={displayOptions} onChange={setDisplayOptions} />
      case FieldType.DATE:
        return <DateFormattingEditor options={displayOptions} onChange={setDisplayOptions} />
      case FieldType.DATETIME:
        return <DateTimeFormattingEditor options={displayOptions} onChange={setDisplayOptions} />
      case FieldType.TIME:
        return <TimeFormattingEditor options={displayOptions} onChange={setDisplayOptions} />
      case FieldType.CHECKBOX:
        return <BooleanFormattingEditor options={displayOptions} onChange={setDisplayOptions} />
      case FieldType.PHONE_INTL:
        return <PhoneFormattingEditor options={displayOptions} onChange={setDisplayOptions} />
      default:
        return null
    }
  }

  /** Render display options section with toggle button */
  const renderDisplayOptionsEditor = () => {
    if (!supportsDisplayOptions(selectedType)) return null

    return (
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between"
          onClick={() => setShowDisplayOptions(!showDisplayOptions)}>
          <span>Display Options</span>
          <ChevronDown
            className={`size-4 transition-transform ${showDisplayOptions ? 'rotate-180' : ''}`}
          />
        </Button>
        {showDisplayOptions && (
          <div className="rounded-lg border p-3">{renderDisplayOptionsContent()}</div>
        )}
      </div>
    )
  }

  // Watch isUnique to hide default value when unique is checked
  const isUnique = form.watch('isUnique')

  /** Render type-aware default value input */
  const renderDefaultValueInput = () => {
    // Hide default value in edit mode or for unique fields
    if (isEditing || isUnique) {
      return null
    }

    if (TYPES_WITHOUT_DEFAULT_VALUE.includes(selectedType)) {
      return null
    }

    return (
      <FormField
        control={form.control}
        name="defaultValue"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Default Value (Optional)</FormLabel>
            <FormControl>{renderDefaultValueControl(field)}</FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    )
  }

  /** Render the actual input control for default value based on type */
  const renderDefaultValueControl = (field: any) => {
    switch (selectedType) {
      case FieldType.NUMBER:
        return <Input type="number" placeholder="0" {...field} />

      case FieldType.CHECKBOX:
        return (
          <div className="flex items-center gap-2 pt-2">
            <Switch
              checked={field.value === 'true'}
              onCheckedChange={(checked) => field.onChange(checked ? 'true' : 'false')}
            />
            <span className="text-sm text-muted-foreground">
              {field.value === 'true' ? 'Checked by default' : 'Unchecked by default'}
            </span>
          </div>
        )

      case FieldType.SINGLE_SELECT:
        return (
          <Select
            value={field.value || '__none__'}
            onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select default option" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No default</SelectItem>
              {selectOptions
                .filter((opt) => opt.value && opt.value.trim() !== '')
                .map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )

      case FieldType.MULTI_SELECT:
        // For multi-select, show a simplified select (could be enhanced to multi-select)
        return (
          <Select
            value={field.value || '__none__'}
            onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select default option(s)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No default</SelectItem>
              {selectOptions
                .filter((opt) => opt.value && opt.value.trim() !== '')
                .map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )

      case FieldType.RICH_TEXT:
        return <Textarea placeholder="Default content" {...field} />

      // TEXT, URL, EMAIL, PHONE_INTL, DATE, TAGS - use simple text input
      default:
        return <Input placeholder="Default value" {...field} />
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size={selectedType === FieldType.RELATIONSHIP ? 'xxl' : 'md'}
          position="tc"
          {...guardProps}>
          {/* className="max-h-3/4 overflow-y-auto" */}
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Field' : 'Create Field'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the field settings below.' : 'Configure your new custom field.'}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)}>
              <FieldGroup className="gap-4">
                {/* Field Type Selector - Only shown in create mode */}
                {!isEditing && (
                  <Field>
                    <FieldLabel>Field Type</FieldLabel>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between">
                          <span className="flex items-center gap-2">
                            {selectedTypeOption && (
                              <EntityIcon
                                iconId={selectedTypeOption.iconId}
                                variant="default"
                                size="default"
                              />
                            )}
                            {selectedTypeOption?.label || 'Select type'}
                          </span>
                          <ChevronDown className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[220px]" align="start">
                        {Object.entries(FIELD_TYPE_GROUPS).map(([groupName, types]) => (
                          <DropdownMenuGroup key={groupName}>
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                              {groupName}
                            </DropdownMenuLabel>
                            {types.map((type) => {
                              const option = fieldTypeOptions[type]
                              if (!option) return null
                              return (
                                <DropdownMenuItem
                                  key={type}
                                  onClick={() => {
                                    form.setValue('type', type)
                                    form.setValue('fieldType', type)
                                  }}
                                  className="flex items-start gap-2 ps-1">
                                  <EntityIcon iconId={option.iconId} variant="full" size="sm" />
                                  <span className="font-medium">{option.label}</span>
                                </DropdownMenuItem>
                              )
                            })}
                          </DropdownMenuGroup>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Field>
                )}

                {/* Field Name and Description - hidden for RELATIONSHIP (handled in RelationshipFieldEditor) */}
                {selectedType !== FieldType.RELATIONSHIP && (
                  <>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Field Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Work Phone" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (Optional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Description or help text for this field"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {/* Required Switch - hide for certain field types */}
                {!TYPES_WITHOUT_REQUIRED.includes(selectedType) && (
                  <FormField
                    control={form.control}
                    name="required"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-xl border px-3 py-1.5">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            size="sm"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Required Field</FormLabel>
                          <FormDescription>Make this field mandatory</FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                )}

                {/* Unique Switch - only shown for uniqueable field types */}
                {canFieldBeUnique(selectedType, relationshipOptions.relationshipType) && (
                  <FormField
                    control={form.control}
                    name="isUnique"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-xl border px-3 py-1.5">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            size="sm"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Unique Value</FormLabel>
                          <FormDescription>
                            Only one record can have this value. Can be used to match records during
                            import.
                            {isEditing && !editingField?.isUnique && field.value && (
                              <span className="block mt-1 text-orange-500">
                                Existing values will be checked for duplicates and may error.
                              </span>
                            )}
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                )}

                {/* Type-specific editors */}
                {renderTypeSpecificEditors()}

                {/* Default Value - rendered after type-specific options */}
                {renderDefaultValueInput()}

                {/* Display options editors for supported field types */}
                {renderDisplayOptionsEditor()}
              </FieldGroup>

              <DialogFooter>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={guardedClose}
                  disabled={isPending}>
                  Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  variant="outline"
                  loading={isPending}
                  loadingText={isEditing ? 'Saving...' : 'Creating...'}>
                  {isEditing ? 'Save Changes' : 'Create Field'}{' '}
                  <KbdSubmit variant="outline" size="sm" />
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
