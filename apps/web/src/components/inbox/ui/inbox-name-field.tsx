// apps/web/src/components/inbox/ui/inbox-name-field.tsx
'use client'

import { getColorSwatch } from '@auxx/lib/custom-fields/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ColorTagPicker } from '~/components/tags/ui/color-tag-picker'

/** Props for {@link InboxNameField}. */
interface InboxNameFieldProps {
  name: string
  onNameChange: (name: string) => void
  color: SelectOptionColor
  onColorChange: (color: SelectOptionColor) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}

/**
 * Inbox name input with the colour swatch folded into it: the dot sits at the head of the
 * field and opens a {@link ColorTagPicker} popover, so colour costs no separate row. Shared
 * by the inbox create/edit dialog and the channel connect step's inline create — the two
 * places an inbox is named. Render inside a `FieldPanelRow`.
 */
export function InboxNameField({
  name,
  onNameChange,
  color,
  onColorChange,
  placeholder = 'Enter inbox name',
  disabled,
  className,
  id,
}: InboxNameFieldProps) {
  return (
    <div className={cn('flex min-h-8 items-center gap-2', className)}>
      <Popover>
        {/* The hover grow lives on the inner dot, never on the trigger: Radix anchors the
            popover to the trigger's measured box, and a transform is inside that measurement —
            scaling the trigger itself makes the open popover drift on hover. The button keeps a
            fixed `size-5` (also a saner hit target than a 14px dot). */}
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type='button'
            aria-label='Inbox color'
            disabled={disabled}
            className={cn(
              'group/dot flex size-5 shrink-0 items-center justify-center rounded-full',
              'focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-60'
            )}>
            <span
              className={cn(
                'size-3.5 rounded-full transition-transform group-hover/dot:scale-115',
                'group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-muted-foreground/50',
                'group-focus-visible/dot:ring-offset-1 group-focus-visible/dot:ring-offset-background',
                getColorSwatch(color)
              )}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent className='w-auto max-w-56 p-3' align='start'>
          <ColorTagPicker value={color} onChange={onColorChange} disabled={disabled} />
        </PopoverContent>
      </Popover>

      <Input
        id={id}
        variant='transparent'
        size='sm'
        className='min-h-8 px-0'
        autoComplete='off'
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  )
}
