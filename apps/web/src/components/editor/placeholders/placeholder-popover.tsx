// apps/web/src/components/editor/placeholders/placeholder-popover.tsx

'use client'

import type { FallbackPayload, FallbackSupportedType } from '@auxx/lib/placeholders/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { ArrowRightLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FieldInputRow } from '~/components/custom-fields/ui/field-input-row'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
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
  /** Swap the placeholder id + clear (or preserve) fallback. */
  onChangeVariable: (newId: string) => void
  /** Patch `fallback` attr on the node. `null` unsets it. */
  onFallbackChange: (payload: FallbackPayload | null) => void
  /** Remove the node. */
  onDelete: () => void
  /** Close the popover after an action. */
  onClose: () => void
}

/**
 * Popover content anchored on a placeholder badge. Two modes:
 * - `edit`: breadcrumb + typed fallback input + footer (change / delete)
 * - `picker`: renders the shared placeholder picker with a back affordance
 */
export function PlaceholderPopover({
  breadcrumb,
  field,
  fieldType,
  fallbackSupported,
  fallback,
  onChangeVariable,
  onFallbackChange,
  onDelete,
  onClose,
}: PlaceholderPopoverProps) {
  const [mode, setMode] = useState<'edit' | 'picker'>('edit')

  if (mode === 'picker') {
    // Match the width of the inline-picker popover (InlinePickerPopover uses
    // width={288}). The badge's host PopoverContent is `w-auto`, so without
    // an explicit width here the picker collapses to fit content.
    return (
      <div className='w-72'>
        <PlaceholderPickerContent
          onBack={() => setMode('edit')}
          backLabel='Fallback'
          onSelect={(newId) => {
            onChangeVariable(newId)
            setMode('edit')
          }}
        />
      </div>
    )
  }

  const currentValue = fallback && fallback.t === fieldType ? extractValue(fallback) : null

  return (
    <div className='flex flex-col gap-2 p-2 w-[320px]'>
      <div className='text-xs text-muted-foreground px-1'>{breadcrumb}</div>

      {fallbackSupported && field && fieldType ? (
        <VarEditorField orientation='vertical'>
          <FieldInputRow
            field={field}
            value={currentValue}
            onChange={(_fieldId, value) => {
              const payload = buildPayload(fieldType, value)
              onFallbackChange(payload)
            }}
            placeholder='Fallback value...'
          />
        </VarEditorField>
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
          onClick={() => setMode('picker')}
          className='h-7 gap-1 text-xs'>
          <ArrowRightLeft className='size-3' />
          Change variable
        </Button>
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
