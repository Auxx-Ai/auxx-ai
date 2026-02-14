// components/organization/GroupPickerField.tsx

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form'
import { FormGroupPicker } from './group-picker'

interface GroupPickerFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  control: Control<TFieldValues>
  name: TName
  label?: string
  description?: string
  placeholder?: string
  createNewHref?: string
  disabled?: boolean
  disableCreate?: boolean
}

export function GroupPickerField<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
>({
  control,
  name,
  label,
  description,
  placeholder,
  createNewHref,
  disabled,
  disableCreate,
}: GroupPickerFieldProps<TFieldValues, TName>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          {label && <FormLabel>{label}</FormLabel>}
          <FormControl>
            <FormGroupPicker
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              placeholder={placeholder}
              createNewHref={createNewHref}
              disabled={disabled}
              disableCreate={disableCreate}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
