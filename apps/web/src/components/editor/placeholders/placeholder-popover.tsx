// apps/web/src/components/editor/placeholders/placeholder-popover.tsx

'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import type {
  FallbackPayload,
  FallbackSupportedType,
  PlaceholderFormatPayload,
  PlaceholderFormatType,
} from '@auxx/lib/placeholders/client'
import { normalizePlaceholderFormat } from '@auxx/lib/placeholders/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  CommandNavigation,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { Separator } from '@auxx/ui/components/separator'
import { ArrowRightLeft, Settings2, Trash2 } from 'lucide-react'
import { FieldInputRow } from '~/components/custom-fields/ui/field-input-row'
import { FieldPanel } from '~/components/global/forms/field-panel'
import { PlaceholderFormattingEditor } from './placeholder-formatting-editor'
import { PlaceholderPickerContent } from './placeholder-picker-content'

interface PlaceholderPopoverProps {
  /** Current placeholder id — used to seed the picker header / breadcrumb. */
  breadcrumb: string
  /** Terminal field (real or shim) for the fallback editor. */
  field: ResourceField | null
  /** Effective field type of the terminal field. */
  fieldType: FallbackSupportedType | null
  /** Whether the terminal field type supports fallback input. */
  fallbackSupported: boolean
  /** Decoded payload stored on the node, or `null` if unset. */
  fallback: FallbackPayload | null
  /** Persisted display-format override for this placeholder occurrence. */
  format: PlaceholderFormatPayload | null
  /** Whether the terminal field has an existing shared formatting editor. */
  formattingSupported: boolean
  /** Swap the placeholder id + clear (or preserve) fallback. */
  onChangeVariable: (newId: string) => void
  /** Patch `fallback` attr on the node. `null` unsets it. */
  onFallbackChange: (payload: FallbackPayload | null) => void
  /** Patch the per-placeholder display-format payload. */
  onFormatChange: (payload: PlaceholderFormatPayload | null) => void
  /** Remove the node. */
  onDelete: () => void
  /** Close the popover after an action. */
  onClose: () => void
}

/** Routes within the placeholder popover's shared command-navigation stack. */
type PlaceholderPopoverNavItem = NavigationItem

/**
 * Popover content anchored on a placeholder badge. Three command-navigation routes:
 * - `edit`: breadcrumb + typed fallback input + footer (change / delete)
 * - `picker`: renders the shared placeholder picker with a back affordance
 * - `formatting`: renders the shared field-options editor for this occurrence
 */
export function PlaceholderPopover({
  breadcrumb,
  field,
  fieldType,
  fallbackSupported,
  fallback,
  format,
  formattingSupported,
  onChangeVariable,
  onFallbackChange,
  onFormatChange,
  onDelete,
  onClose,
}: PlaceholderPopoverProps) {
  return (
    <CommandNavigation<PlaceholderPopoverNavItem>>
      <PlaceholderPopoverContent
        breadcrumb={breadcrumb}
        field={field}
        fieldType={fieldType}
        fallbackSupported={fallbackSupported}
        fallback={fallback}
        format={format}
        formattingSupported={formattingSupported}
        onChangeVariable={onChangeVariable}
        onFallbackChange={onFallbackChange}
        onFormatChange={onFormatChange}
        onDelete={onDelete}
        onClose={onClose}
      />
    </CommandNavigation>
  )
}

/** Render the placeholder popover for the current shared navigation route. */
function PlaceholderPopoverContent({
  breadcrumb,
  field,
  fieldType,
  fallbackSupported,
  fallback,
  format,
  formattingSupported,
  onChangeVariable,
  onFallbackChange,
  onFormatChange,
  onDelete,
  onClose,
}: PlaceholderPopoverProps) {
  const { current, isAtRoot, pop, push, reset } = useCommandNavigation<PlaceholderPopoverNavItem>()
  const route = current?.id

  if (route === 'picker' || (!isAtRoot && route !== 'formatting')) {
    // Match the width of the inline-picker popover (InlinePickerPopover uses
    // width={288}). The badge's host PopoverContent is `w-auto`, so without
    // an explicit width here the picker collapses to fit content.
    return (
      <div className='w-72'>
        <PlaceholderPickerContent
          onBack={pop}
          backLabel='Placeholder'
          navigationOffset={1}
          onSelect={(newId) => {
            onChangeVariable(newId)
            reset()
          }}
        />
      </div>
    )
  }

  const currentValue = fallback && fallback.t === fieldType ? extractValue(fallback) : null
  const formattingType =
    formattingSupported && fieldType ? (fieldType as PlaceholderFormatType) : null
  const formattingOptions = {
    ...field?.options,
    ...(format?.t === formattingType ? format.o : {}),
  }

  if (route === 'formatting' && formattingType) {
    return (
      <div className='w-80 p-2'>
        <Button variant='ghost' size='sm' onClick={pop} className='mb-2'>
          Back
        </Button>
        <PlaceholderFormattingEditor
          fieldType={formattingType}
          options={formattingOptions as Partial<FieldOptions>}
          onChange={(options) => {
            onFormatChange(normalizePlaceholderFormat({ v: 1, t: formattingType, o: options }))
          }}
        />
        {format && (
          <Button variant='ghost' size='xs' onClick={() => onFormatChange(null)} className='mt-2'>
            Use field default
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2 p-2 w-[320px]'>
      <div className='text-xs text-muted-foreground px-1'>{breadcrumb}</div>

      {fallbackSupported && field && fieldType ? (
        <FieldPanel orientation='vertical'>
          <FieldInputRow
            field={field}
            value={currentValue}
            onChange={(_fieldId, value) => {
              const payload = buildPayload(fieldType, value)
              onFallbackChange(payload)
            }}
            placeholder='Fallback value...'
          />
        </FieldPanel>
      ) : (
        <div className='text-xs text-muted-foreground px-1 py-2'>
          Fallback not available for this field type.
        </div>
      )}

      <Separator />

      <div className='flex items-center justify-between gap-2'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => push({ id: 'picker', label: 'Placeholder' })}
          className='h-7 gap-1 text-xs'>
          <ArrowRightLeft className='size-3' />
          Change variable
        </Button>
        <div className='flex items-center gap-1'>
          {formattingType && (
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => push({ id: 'formatting', label: 'Formatting' })}
              className='h-7 w-7 text-muted-foreground'
              aria-label='Format placeholder'>
              <Settings2 className='size-3' />
            </Button>
          )}
          <Button
            variant='ghost'
            size='icon-sm'
            onClick={() => {
              onDelete()
              onClose()
            }}
            className='h-7 w-7 text-muted-foreground hover:text-destructive'
            aria-label='Remove placeholder'>
            <Trash2 className='size-3' />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Extract the value shape `FieldInputRow` expects from a typed payload.
 * Never returns `undefined` — unset payload collapses to `null` so the input
 * renders empty.
 */
function extractValue(payload: FallbackPayload): unknown {
  return payload.d
}

/**
 * Build a `FallbackPayload` from the editor's current value for a given
 * field type. Returns `null` when the value is empty — callers should clear
 * the fallback attribute in that case.
 */
function buildPayload(t: FallbackSupportedType, value: unknown): FallbackPayload | null {
  switch (t) {
    case 'TEXT':
    case 'URL':
    case 'EMAIL':
    case 'PHONE_INTL': {
      const s = typeof value === 'string' ? value : ''
      return s.length > 0 ? { v: 1, t, d: s } : null
    }
    case 'NUMBER':
    case 'CURRENCY': {
      if (value === null || value === undefined || value === '') return null
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(n) ? { v: 1, t, d: n } : null
    }
    case 'DATE':
    case 'DATETIME':
    case 'TIME': {
      const s = typeof value === 'string' ? value : ''
      return s.length > 0 ? { v: 1, t, d: s } : null
    }
    case 'CHECKBOX': {
      return { v: 1, t, d: Boolean(value) }
    }
    case 'NAME': {
      const v = (value ?? {}) as { firstName?: string; lastName?: string }
      const firstName = v.firstName ?? ''
      const lastName = v.lastName ?? ''
      return firstName || lastName ? { v: 1, t, d: { firstName, lastName } } : null
    }
  }
}
