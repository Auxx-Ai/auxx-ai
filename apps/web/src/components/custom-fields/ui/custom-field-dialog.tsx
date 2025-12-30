// apps/web/src/components/custom-fields/ui/custom-field-dialog.tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { v4 as uuidv4 } from 'uuid'
import { ChevronDown } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@auxx/ui/components/dialog'
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

import { OptionsEditor } from './options-editor'
import { AddressComponentsEditor } from './address-component-editor'
import { FileOptionsEditor, type FileOptions } from './file-options-editor'
import { RelationshipFieldEditor, type RelationshipOptions } from './relationship-field-editor'
import { CurrencyOptionsEditor, type CurrencyOptions } from './currency-options-editor'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'

/** Field data for editing */
interface CustomFieldData {
  id: string
  name: string
  type: string
  description?: string | null
  required?: boolean
  isUnique?: boolean
  defaultValue?: string | null
  icon?: string | null
  isCustom?: boolean
  options?: any
}

/** Props for CustomFieldDialog */
interface CustomFieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass existing field for edit mode, null/undefined for create mode */
  editingField?: CustomFieldData | null
  onSave: (field: any) => Promise<void>
  isPending: boolean
  /** Resource ID for the current entity (used by relationship field editor) */
  currentResourceId?: string
}

/**
 * Unified dialog for creating and editing custom fields
 * - Create mode: shows field type dropdown
 * - Edit mode: hides field type (cannot be changed)
 */
export function CustomFieldDialog({
  open,
  onOpenChange,
  editingField = null,
  onSave,
  isPending,
  currentResourceId,
}: CustomFieldDialogProps) {
  const isEditing = !!editingField

  // Form setup
  const form = useForm<CustomFieldFormValues>({
    resolver: standardSchemaResolver(customFieldFormSchema),
    defaultValues: {
      name: '',
      type: FieldType.TEXT,
      description: '',
      required: false,
      isUnique: false,
      defaultValue: '',
      icon: '',
      isCustom: true,
    },
  })

  // States for complex field options
  const [options, setOptions] = useState<Array<{ label: string; value: string; color?: SelectOptionColor }>>([])
  const [addressComponents, setAddressComponents] = useState<string[]>([
    'street1',
    'street2',
    'city',
    'state',
    'zipCode',
    'country',
  ])
  const [fileOptions, setFileOptions] = useState<FileOptions>({
    allowMultiple: false,
    maxFiles: undefined,
    allowedFileTypes: undefined,
    allowedFileExtensions: undefined,
  })
  const [relationshipOptions, setRelationshipOptions] = useState<RelationshipOptions>({
    relatedResourceId: 'contact',
    relationshipType: 'belongs_to',
    inverseName: '',
  })
  const [currencyOptions, setCurrencyOptions] = useState<CurrencyOptions>({
    currencyCode: 'USD',
    decimalPlaces: 'two-places',
    displayType: 'symbol',
    groups: 'default',
  })

  // Track initial values for extra state (not managed by react-hook-form)
  const [initialExtraState, setInitialExtraState] = useState<{
    options: Array<{ label: string; value: string; color?: SelectOptionColor }>
    addressComponents: string[]
    fileOptions: FileOptions
    relationshipOptions: RelationshipOptions
    currencyOptions: CurrencyOptions
  } | null>(null)

  // Check if extra state (outside react-hook-form) has changed
  const isExtraStateDirty = useMemo(() => {
    if (!initialExtraState) return false
    const optionsChanged = JSON.stringify(options) !== JSON.stringify(initialExtraState.options)
    const addressChanged =
      JSON.stringify(addressComponents) !== JSON.stringify(initialExtraState.addressComponents)
    const fileChanged =
      JSON.stringify(fileOptions) !== JSON.stringify(initialExtraState.fileOptions)
    const relationshipChanged =
      JSON.stringify(relationshipOptions) !== JSON.stringify(initialExtraState.relationshipOptions)
    const currencyChanged =
      JSON.stringify(currencyOptions) !== JSON.stringify(initialExtraState.currencyOptions)
    return optionsChanged || addressChanged || fileChanged || relationshipChanged || currencyChanged
  }, [options, addressComponents, fileOptions, relationshipOptions, currencyOptions, initialExtraState])

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
      let initOptions: Array<{ label: string; value: string; color?: SelectOptionColor }> = []
      let initAddressComponents: string[] = ['street1', 'street2', 'city', 'state', 'zipCode', 'country']
      let initFileOptions: FileOptions = {
        allowMultiple: false,
        maxFiles: undefined,
        allowedFileTypes: undefined,
        allowedFileExtensions: undefined,
      }
      let initRelationshipOptions: RelationshipOptions = {
        relatedResourceId: 'contact',
        relationshipType: 'belongs_to',
        inverseName: '',
      }
      let initCurrencyOptions: CurrencyOptions = {
        currencyCode: 'USD',
        decimalPlaces: 'two-places',
        displayType: 'symbol',
        groups: 'default',
      }

      if (editingField) {
        // Edit mode: populate form with existing field data
        form.reset({
          name: editingField.name || '',
          type: (editingField.type as FieldTypeType) || FieldType.TEXT,
          description: editingField.description || '',
          required: editingField.required || false,
          isUnique: editingField.isUnique || false,
          defaultValue: editingField.defaultValue || '',
          icon: editingField.icon || '',
          isCustom: editingField.isCustom !== undefined ? editingField.isCustom : true,
        })

        // Set complex options
        if (editingField.options?.options && Array.isArray(editingField.options.options)) {
          initOptions = editingField.options.options
        } else if (Array.isArray(editingField.options)) {
          initOptions = editingField.options
        }
        setOptions(initOptions)

        if (
          editingField.options?.addressComponents &&
          Array.isArray(editingField.options.addressComponents)
        ) {
          initAddressComponents = editingField.options.addressComponents
        }
        setAddressComponents(initAddressComponents)

        // Parse file options - handle both new structure (options.file) and legacy format
        if (editingField.options?.file) {
          initFileOptions = {
            allowMultiple: editingField.options.file.allowMultiple || false,
            maxFiles: editingField.options.file.maxFiles,
            allowedFileTypes: editingField.options.file.allowedFileTypes,
            allowedFileExtensions: editingField.options.file.allowedFileExtensions,
          }
        } else if (editingField.options?.allowMultiple !== undefined) {
          // Legacy format support
          initFileOptions = {
            allowMultiple: editingField.options.allowMultiple,
            maxFiles: undefined,
            allowedFileTypes: undefined,
            allowedFileExtensions: undefined,
          }
        }
        setFileOptions(initFileOptions)

        if (editingField.options?.relationship) {
          initRelationshipOptions = {
            relatedResourceId: editingField.options.relationship.relatedResourceId || 'contact',
            relationshipType: editingField.options.relationship.relationshipType || 'belongs_to',
            inverseName: editingField.options.relationship.inverseName || '',
            inverseDescription: editingField.options.relationship.inverseDescription,
            inverseIcon: editingField.options.relationship.inverseIcon,
          }
        }
        setRelationshipOptions(initRelationshipOptions)

        if (editingField.options?.currency) {
          initCurrencyOptions = {
            currencyCode: editingField.options.currency.currencyCode || 'USD',
            decimalPlaces: editingField.options.currency.decimalPlaces || 'two-places',
            displayType: editingField.options.currency.displayType || 'symbol',
            groups: editingField.options.currency.groups || 'default',
          }
        }
        setCurrencyOptions(initCurrencyOptions)
      } else {
        // Create mode: reset to defaults
        form.reset({
          name: '',
          type: FieldType.TEXT,
          description: '',
          required: false,
          isUnique: false,
          defaultValue: '',
          icon: '',
          isCustom: true,
        })
        setOptions(initOptions)
        setAddressComponents(initAddressComponents)
        setFileOptions(initFileOptions)
        setRelationshipOptions(initRelationshipOptions)
        setCurrencyOptions(initCurrencyOptions)
      }

      // Set baseline for dirty checking
      setInitialExtraState({
        options: initOptions,
        addressComponents: initAddressComponents,
        fileOptions: initFileOptions,
        relationshipOptions: initRelationshipOptions,
        currencyOptions: initCurrencyOptions,
      })
    }
  }, [open, editingField, form])

  // Watch selected type
  const selectedType = form.watch('type')

  // Get selected field type option for display
  const selectedTypeOption = fieldTypeOptions.find((opt) => opt.value === selectedType)

  // Clear default value and reset isUnique when type changes (in create mode only)
  useEffect(() => {
    if (!isEditing) {
      form.setValue('defaultValue', '')
      // Reset isUnique if new type doesn't support uniqueness
      if (!canFieldBeUnique(selectedType, relationshipOptions.relationshipType)) {
        form.setValue('isUnique', false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, isEditing])

  /** Handle form submission */
  const handleSubmit = async (values: CustomFieldFormValues) => {
    const submitObj: any = {
      ...values,
      id: editingField?.id || uuidv4(),
    }

    // Add type-specific options
    if (values.type === FieldType.SINGLE_SELECT || values.type === FieldType.MULTI_SELECT) {
      submitObj.options = options
    }

    if (values.type === FieldType.ADDRESS_STRUCT) {
      submitObj.addressComponents = addressComponents
    }

    if (values.type === FieldType.FILE) {
      submitObj.options = { file: fileOptions }
    }

    if (values.type === FieldType.RELATIONSHIP) {
      submitObj.relationship = relationshipOptions
    }

    if (values.type === FieldType.CURRENCY) {
      submitObj.options = { currency: currencyOptions }
    }

    await onSave(submitObj)
    onOpenChange(false)
  }

  /** Render type-specific editors */
  const renderTypeSpecificEditors = () => {
    switch (selectedType) {
      case FieldType.SINGLE_SELECT:
      case FieldType.MULTI_SELECT:
        return <OptionsEditor options={options} onChange={setOptions} />
      case FieldType.ADDRESS_STRUCT:
        return (
          <AddressComponentsEditor components={addressComponents} onChange={setAddressComponents} />
        )
      case FieldType.FILE:
        return <FileOptionsEditor options={fileOptions} onChange={setFileOptions} />
      case FieldType.RELATIONSHIP:
        return (
          <RelationshipFieldEditor
            options={relationshipOptions}
            onChange={setRelationshipOptions}
            currentResourceId={currentResourceId}
            name={form.watch('name')}
            onNameChange={(v) => form.setValue('name', v)}
          />
        )
      case FieldType.CURRENCY:
        return <CurrencyOptionsEditor options={currencyOptions} onChange={setCurrencyOptions} />
      default:
        return null
    }
  }

  /** Render type-aware default value input */
  const renderDefaultValueInput = () => {
    // These types don't support default values
    if (
      selectedType === FieldType.ADDRESS_STRUCT ||
      selectedType === FieldType.FILE ||
      selectedType === FieldType.RELATIONSHIP ||
      selectedType === FieldType.CURRENCY
    ) {
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
              {options
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
              {options
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
        <DialogContent size={selectedType === FieldType.RELATIONSHIP ? 'xxl' : 'md'} position="tc" {...guardProps}>
        {/* className="max-h-3/4 overflow-y-auto" */}
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Custom Field' : 'Create Custom Field'}</DialogTitle>
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
                          {selectedTypeOption && <selectedTypeOption.icon className="size-4" />}
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
                            const option = fieldTypeOptions.find((opt) => opt.value === type)
                            if (!option) return null
                            return (
                              <DropdownMenuItem
                                key={option.value}
                                onClick={() => form.setValue('type', option.value)}
                                className="flex items-start gap-2 ps-1">
                                <div className="rounded-full ring-1 ring-ring bg-secondary flex items-center justify-center size-5">
                                  <option.icon className="size-3 shrink-0" />
                                </div>
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

              {/* Required Switch */}
              <FormField
                control={form.control}
                name="required"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-xl border px-3 py-1.5">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} size="sm" />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Required Field</FormLabel>
                      <FormDescription>Make this field mandatory</FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              {/* Unique Switch - only shown for uniqueable field types */}
              {canFieldBeUnique(selectedType, relationshipOptions.relationshipType) && (
                <FormField
                  control={form.control}
                  name="isUnique"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-xl border px-3 py-1.5">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} size="sm" />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Unique Value</FormLabel>
                        <FormDescription>
                          Only one record can have this value. Can be used to match records during import.
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
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={guardedClose}
                disabled={isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                type="submit"
                variant="outline"
                loading={isPending}
                loadingText={isEditing ? 'Saving...' : 'Creating...'}>
                {isEditing ? 'Save Changes' : 'Create Field'}
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
