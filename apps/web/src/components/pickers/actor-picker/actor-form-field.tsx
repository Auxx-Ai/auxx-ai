// apps/web/src/components/pickers/actor-picker/actor-form-field.tsx

'use client'

import { useController, type Control } from 'react-hook-form'
import { Button } from '@auxx/ui/components/button'
import { FormControl, FormField, FormItem, FormMessage, FormLabel } from '@auxx/ui/components/form'
import { Plus } from 'lucide-react'
import { ActorPicker } from './actor-picker'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import type { ActorId } from '@auxx/types/actor'

interface ActorFormFieldProps {
  /** Field name in form */
  name: string
  /** Form control from useForm */
  control: Control<any>
  /** Label text */
  label?: string
  /** Disabled state */
  disabled?: boolean
  /** Actor target: 'user', 'group', or 'both' */
  target?: 'user' | 'group' | 'both'
  /** Placeholder for empty state */
  placeholder?: string
}

/**
 * Form field for selecting actors (users/groups) with react-hook-form.
 * Uses ActorPicker internally and ActorBadge with onRemove for display.
 */
export function ActorFormField({
  name,
  control,
  label,
  disabled = false,
  target = 'both',
  placeholder = 'Add members or groups',
}: ActorFormFieldProps) {
  const { field } = useController({
    name,
    control,
    defaultValue: [] as ActorId[],
  })

  const selectedActorIds: ActorId[] = field.value || []

  /** Handle selection changes from the picker */
  const handleChange = (actorIds: ActorId[]) => {
    field.onChange(actorIds)
  }

  /** Handle removing an actor via badge X button */
  const handleRemove = (actorId: ActorId) => {
    field.onChange(selectedActorIds.filter((id) => id !== actorId))
  }

  return (
    <FormField
      control={control}
      name={name}
      render={() => (
        <FormItem>
          {label && <FormLabel>{label}</FormLabel>}
          <FormControl>
            <div className="space-y-3">
              {/* Selected items - uses ActorBadge with onRemove */}
              <div className="flex flex-wrap gap-2">
                {selectedActorIds.map((actorId) => (
                  <ActorBadge
                    key={actorId}
                    actorId={actorId}
                    onRemove={disabled ? undefined : handleRemove}
                  />
                ))}
                {selectedActorIds.length === 0 && (
                  <span className="text-sm text-muted-foreground">No selection</span>
                )}
              </div>

              {/* Picker */}
              <ActorPicker
                value={selectedActorIds}
                onChange={handleChange}
                target={target}
                disabled={disabled}>
                <Button type="button" variant="outline" size="sm" disabled={disabled}>
                  <Plus />
                  {placeholder}
                </Button>
              </ActorPicker>
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
