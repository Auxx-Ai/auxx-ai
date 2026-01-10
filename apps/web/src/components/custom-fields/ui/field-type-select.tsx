// apps/web/src/components/custom-fields/ui/field-type-select.tsx
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
import type { FieldType } from '@auxx/database/types'
import { EntityIcon } from '@auxx/ui/components/icons'

/** Props for FieldTypeSelect component */
interface FieldTypeSelectProps {
  field: any
  disabled?: boolean
}

/**
 * FieldTypeSelect component used inside FieldForm component (inside app/settings)
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
          {(Object.entries(fieldTypeOptions) as [FieldType, (typeof fieldTypeOptions)[FieldType]][]).map(
            ([type, option]) => (
              <SelectItem key={type} value={type}>
                <span className="flex items-center gap-2">
                  <EntityIcon iconId={option.iconId} variant="default" size="sm" />
                  {option.label}
                </span>
              </SelectItem>
            )
          )}
        </SelectContent>
      </Select>
      <FormDescription>
        The type of field determines how data is collected and validated.
      </FormDescription>
      <FormMessage />
    </FormItem>
  )
}
