// apps/web/src/components/editor/inline-picker/nodes/placeholder-badge.tsx

'use client'

import {
  type FallbackPayload,
  type FallbackSupportedType,
  isFallbackSupportedType,
  tryParsePlaceholderId,
} from '@auxx/lib/placeholders/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'
import { isFieldPath, type ResourceFieldId } from '@auxx/types/field'
import { Badge } from '@auxx/ui/components/badge'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { useId, useState } from 'react'
import { usePlaceholderLabel } from '~/components/editor/placeholders/catalog'
import { PlaceholderPopover } from '~/components/editor/placeholders/placeholder-popover'
import { useEditorActiveStateContext } from '~/components/mail/email-editor/editor-active-state-context'
import { useResourceStore } from '~/components/resources/store/resource-store'
import type { InlineNodeBadgeProps } from '../types'

/**
 * Try to read the host editor's active-state context. Placeholders render
 * in several editors — the mail email editor provides this context, others
 * don't. Returning `null` when the context is absent lets the same badge
 * work in every host without the context becoming a required dependency.
 */
function useOptionalEditorActiveState() {
  try {
    return useEditorActiveStateContext()
  } catch {
    return null
  }
}

/**
 * Badge renderer for placeholder inline nodes.
 *
 * - Icon + breadcrumb come from `usePlaceholderLabel` (parity with the
 *   field picker — relationship fields show the target resource's icon,
 *   regular fields show their `FieldType` icon, dates show a calendar).
 * - Unresolvable tokens render in the destructive variant with a warning.
 * - Clicking the badge opens a popover with a fallback editor + footer.
 */
export function PlaceholderBadge({
  id,
  selected,
  attrs,
  updateAttributes,
  deleteNode,
}: InlineNodeBadgeProps) {
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const activeState = useOptionalEditorActiveState()
  const { breadcrumb, resolved, iconId, iconColor, field, fieldType, fallbackSupported } =
    usePlaceholderLabel(id)

  const fallback = (attrs.fallback as FallbackPayload | null) ?? null

  const onFallbackChange = (payload: FallbackPayload | null) => {
    updateAttributes({ fallback: payload })
  }

  const onChangeVariable = (newId: string) => {
    // Preserve the fallback if the old and new field types match; otherwise
    // clear it (payload shape is type-specific and won't round-trip).
    const current = (attrs.fallback as FallbackPayload | null) ?? null
    const preserve = current && fieldTypeFromNewId(newId) === current.t
    updateAttributes({ id: newId, fallback: preserve ? current : null })
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!activeState) return
    if (next) activeState.trackPopoverOpen(popoverId)
    else activeState.trackPopoverClose(popoverId)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Badge
          variant={resolved ? 'pill' : 'destructive'}
          className={cn(
            'group/badge relative inline-flex items-center gap-1 px-1.5 py-0 text-xs cursor-pointer align-baseline',
            selected && 'ring-2 ring-primary ring-offset-1',
            fallback && 'ring-1 ring-primary/30'
          )}
          title={id}>
          {resolved ? (
            <EntityIcon iconId={iconId} color={iconColor} size='xs' />
          ) : (
            <AlertTriangle className='size-3 shrink-0' />
          )}
          <span className='truncate max-w-[200px]'>{breadcrumb}</span>
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='p-0 w-auto'
        onOpenAutoFocus={(e) => {
          // Keep focus inside the popover but let the first focusable element
          // (the input) claim it naturally rather than the wrapper div.
          e.preventDefault()
        }}>
        <PlaceholderPopover
          breadcrumb={breadcrumb}
          field={field}
          fieldType={fieldType}
          fallbackSupported={fallbackSupported}
          fallback={fallback}
          onChangeVariable={onChangeVariable}
          onFallbackChange={onFallbackChange}
          onDelete={deleteNode}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Resolve the effective field type for a placeholder id — used to decide
 * whether a fallback payload survives a "Change variable" swap.
 *
 * `date:*` never has a fallback, so we only care about `org:*` and field
 * tokens. The read-side guard in the popover (`payload.t === fieldType`)
 * is the real safety net; this is just an optimization to avoid dropping
 * a compatible fallback on same-type swaps.
 */
function fieldTypeFromNewId(newId: string): FallbackSupportedType | null {
  const parsed = tryParsePlaceholderId(newId)
  if (!parsed) return null
  if (parsed.kind === 'date') return null
  if (parsed.kind === 'org') {
    return parsed.slug === 'website' ? 'URL' : 'TEXT'
  }
  // Field token — walk the path to the terminal field, look up its fieldType
  // in the resource store, and normalize via mapBaseTypeToFieldType for
  // system fields.
  const ids: ResourceFieldId[] = isFieldPath(parsed.fieldRef)
    ? [...parsed.fieldRef]
    : [parsed.fieldRef]
  const terminalId = ids[ids.length - 1]
  if (!terminalId) return null
  const field = useResourceStore.getState().fieldMap[terminalId]
  if (!field) return null
  const effective =
    field.fieldType ?? (field.type ? (mapBaseTypeToFieldType(field.type as any) ?? null) : null)
  if (!effective) return null
  return isFallbackSupportedType(effective) ? effective : null
}
