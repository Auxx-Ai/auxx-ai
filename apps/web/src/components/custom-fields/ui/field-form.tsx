// ~/components/contacts/fields/FieldForm.tsx
/**
 * FieldForm
 *
 * @description: A form component for creating or editing contact fields.
 * @usage: This component is used in the contact fields management section in apps/settings/
 */
import { z } from 'zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Switch } from '@auxx/ui/components/switch'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { FieldTypeSelect } from './field-type-select'
import { OptionsEditor } from './options-editor'
import { AddressComponentsEditor } from './address-component-editor'
import { getFieldOptionsSchema, canFieldBeUnique } from '@auxx/lib/custom-fields/types'
import { FieldType } from '@auxx/database/enums'
// import { getFieldOptionsSchema } from './field-options-schema'
// Form schema (now includes icon, isCustom, options)
const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(FieldType),
  description: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.string().optional(),
  icon: z.string().optional(),
  isCustom: z.boolean().default(true),
  options: z.unknown().optional(),
  isUnique: z.boolean().default(false),
})
interface FieldFormProps {
  initialValues?: z.infer<typeof formSchema> & {
    options?: Array<{
      label: string
      value: string
    }>
    addressComponents?: string[]
  }
  onSubmit: (values: any) => void // Accepts merged values
  onCancel?: () => void
  isSubmitting?: boolean
  isEditing?: boolean
}
/**
 * FieldForm component for creating or editing a contact field used inside app/settings
 * @param param0 - Props for the FieldForm component.
 * @returns JSX.Element
 */
export function FieldForm({
  initialValues,
  onSubmit,
  onCancel,
  isSubmitting = false,
  isEditing = false,
}: FieldFormProps) {
  // Form setup
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: initialValues || {
      name: '',
      type: FieldType.TEXT,
      description: '',
      required: false,
      defaultValue: '',
      icon: '',
      isCustom: true,
      options: undefined,
      isUnique: false,
    },
  })
  // States for complex fields
  const [options, setOptions] = useState<
    Array<{
      label: string
      value: string
    }>
  >(initialValues?.options || [])
  const [addressComponents, setAddressComponents] = useState<string[]>(
    initialValues?.addressComponents || [
      'street1',
      'street2',
      'city',
      'state',
      'zipCode',
      'country',
    ]
  )
  // Get the selected field type
  const selectedType = form.watch('type')
  // Update options when editing
  useEffect(() => {
    if (initialValues) {
      setOptions(initialValues.options || [])
      setAddressComponents(
        initialValues.addressComponents || [
          'street1',
          'street2',
          'city',
          'state',
          'zipCode',
          'country',
        ]
      )
    }
  }, [initialValues])
  // Handle form submission
  const handleSubmit = (values: z.infer<typeof formSchema>) => {
    // Merge in options/addressComponents if relevant
    const submitObj: any = { ...values }
    if (values.type === FieldType.SINGLE_SELECT || values.type === FieldType.MULTI_SELECT) {
      submitObj.options = options
    }
    if (values.type === FieldType.ADDRESS_STRUCT) {
      submitObj.addressComponents = addressComponents
    }
    // Validate options using the correct schema
    if (submitObj.options) {
      const optionsSchema = getFieldOptionsSchema(values.type)
      optionsSchema.parse(submitObj.options)
    }
    onSubmit(submitObj)
  }
  // Render field-specific options based on type
  const renderTypeSpecificFields = () => {
    switch (selectedType) {
      case 'SINGLE_SELECT':
      case 'MULTI_SELECT':
        return <OptionsEditor options={options} onChange={setOptions} />
      case 'ADDRESS_STRUCT':
        return (
          <AddressComponentsEditor components={addressComponents} onChange={setAddressComponents} />
        )
      default:
        return null
    }
  }
  return (
    <div className="pt-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Field Name</FormLabel>
                <FormControl>
                  <Input placeholder="Work Phone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="type"
            render={({ field }) => <FieldTypeSelect field={field} disabled={isEditing} />}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Description or help text for this field" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="required"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-xl border px-3 py-1.5">
                <div className="space-y-0.5">
                  <FormLabel>Required Field</FormLabel>
                  <FormDescription>Make this field mandatory for contacts</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} size="sm" />
                </FormControl>
              </FormItem>
            )}
          />

          {canFieldBeUnique(selectedType) && (
            <FormField
              control={form.control}
              name="isUnique"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-xl border px-3 py-1.5">
                  <div className="space-y-0.5">
                    <FormLabel>Unique</FormLabel>
                    <FormDescription>
                      Only one record can have this value. Can be used to match records during
                      import.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} size="sm" />
                  </FormControl>
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="defaultValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default Value (Optional)</FormLabel>
                <FormControl>
                  <Input placeholder="Default value" {...field} />
                </FormControl>
                <FormDescription>Pre-filled value for new contacts</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Render type-specific fields */}
          {renderTypeSpecificFields()}

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isEditing ? 'Update Field' : 'Add Field'}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Form>
    </div>
  )
}
