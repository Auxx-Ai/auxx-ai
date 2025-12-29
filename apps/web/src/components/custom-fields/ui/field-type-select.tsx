// ~/components/contacts/fields/FieldTypeSelect.tsx
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '@auxx/ui/components/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'

interface FieldTypeSelectProps {
  field: any
  disabled?: boolean
}
/**
 * FieldTypeSelect component  used inside FieldForm component (inside app/settings)
 * @param param0 - Props for the FieldTypeSelect component.
 * @returns
 */
export function FieldTypeSelect({ field, disabled = false }: FieldTypeSelectProps) {
  return (
    <FormItem>
      <FormLabel>Field Type</FormLabel>
      <Select
        onValueChange={field.onChange}
        defaultValue={field.value}
        value={field.value}
        disabled={disabled}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Select a field type" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {fieldTypeOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FormDescription>
        The type of field determines how data is collected and validated.
      </FormDescription>
      <FormMessage />
    </FormItem>
  )
}
