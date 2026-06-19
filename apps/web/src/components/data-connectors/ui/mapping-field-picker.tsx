// apps/web/src/components/data-connectors/ui/mapping-field-picker.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useCustomFieldMutations } from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { FieldPicker } from '~/components/pickers/field-picker'
import { lastSegment } from '../hooks/use-source-paths'
import { isSourceTargetCompatible, isWritableTarget } from './field-type-compat'

/** Field types offered by the lightweight quick-create, seeded from the source type. */
const QUICK_CREATE_TYPES: Array<{ value: FieldTypeType; label: string }> = [
  { value: FieldType.TEXT, label: 'Text' },
  { value: FieldType.NUMBER, label: 'Number' },
  { value: FieldType.EMAIL, label: 'Email' },
  { value: FieldType.URL, label: 'URL' },
  { value: FieldType.DATE, label: 'Date' },
  { value: FieldType.CHECKBOX, label: 'Checkbox' },
  { value: FieldType.TAGS, label: 'Tags' },
]

/** Infer a sensible create-field type from the source node (last segment + JSON type). */
function inferFieldType(path: string, sourceType: string): FieldTypeType {
  if (sourceType === 'array') return FieldType.TAGS
  if (sourceType === 'number' || sourceType === 'integer') return FieldType.NUMBER
  if (sourceType === 'boolean') return FieldType.CHECKBOX
  const seg = lastSegment(path).toLowerCase()
  if (seg.includes('email')) return FieldType.EMAIL
  if (seg.includes('url') || seg.includes('website')) return FieldType.URL
  if (seg.endsWith('_at') || seg.includes('date')) return FieldType.DATE
  return FieldType.TEXT
}

/** Title-case a source segment for the seeded field name (`total_price` → `Total Price`). */
function humanize(path: string): string {
  return lastSegment(path)
    .replace(/\[\]$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

interface MappingFieldPickerProps {
  /** The def whose fields are the binding targets. Null until a target is picked. */
  entityDefinitionId: string | null
  /** The source node being bound — drives the type filter + quick-create seed. */
  sourceType: string
  sourcePath: string
  /** The currently-bound target field key, if any. */
  assignedKey: string | undefined
  /** Resolved label for the bound key (for the chip), if known. */
  assignedLabel: string | undefined
  /** Quick-create is wired only for owned defs (plan decision 3). */
  canCreate: boolean
  /** Bind this source node to the chosen target field key. */
  onAssign: (fieldKey: string) => void
  /** Unbind this source node — surfaced as the in-picker "Don't map" option. */
  onClear: () => void
}

/**
 * The leaf-row target control (plan §5.2) — the canonical {@link FieldPicker}
 * replacing the old bare `<Select>`. Takes the selected `field.key` (relationship
 * drill is disabled in v1), filters targets by source-type compatibility, and on
 * owned defs offers a lightweight inline quick-create seeded from the source node.
 */
export function MappingFieldPicker({
  entityDefinitionId,
  sourceType,
  sourcePath,
  assignedKey,
  assignedLabel,
  canCreate,
  onAssign,
  onClear,
}: MappingFieldPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const chipLabel = assignedKey ? (assignedLabel ?? assignedKey) : 'Apply field…'

  // No target def yet — the FieldPicker has nothing to resolve against. Show a
  // disabled trigger; binding unlocks once a target def is picked (plan 08 §3.4).
  if (!entityDefinitionId) {
    return (
      <Button
        variant='transparent'
        disabled
        className='h-9 w-full justify-between rounded-none px-2 text-xs text-muted-foreground'>
        <span className='truncate'>Pick a target def…</span>
        <ChevronDown className='size-3 opacity-50' />
      </Button>
    )
  }

  return (
    <>
      <FieldPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        entityDefinitionId={entityDefinitionId}
        excludeFields={[FieldType.RELATIONSHIP]}
        // Only fields the sync can actually write (creatable + updatable, not
        // computed) AND whose type accepts this source value.
        filterField={(f) =>
          isWritableTarget(f) && isSourceTargetCompatible(f.fieldType, sourceType)
        }
        mode='single'
        searchPlaceholder='Search fields…'
        onSelect={(_ref, field) => onAssign(field.key)}
        // Skip = unbind. Only offered once a field is bound (an unbound source
        // node is already "not mapped").
        onSkip={assignedKey ? onClear : undefined}
        skipLabel="Don't map this field"
        onCreateField={
          canCreate
            ? () => {
                setPickerOpen(false)
                setCreating(true)
              }
            : undefined
        }
        trigger={
          <Button
            variant='transparent'
            className={`h-9 w-full justify-between rounded-none px-2 text-xs hover:bg-primary/5 ${
              assignedKey ? '' : 'text-muted-foreground'
            }`}>
            <span className='truncate'>{chipLabel}</span>
            <ChevronDown className='size-3 opacity-50' />
          </Button>
        }
      />

      {/* Lightweight inline quick-create (owned defs only). */}
      <Popover open={creating} onOpenChange={setCreating}>
        <PopoverTrigger asChild>
          <span className='sr-only' />
        </PopoverTrigger>
        <PopoverContent align='end' className='w-64 p-3'>
          <QuickCreateFieldForm
            entityDefinitionId={entityDefinitionId}
            seedName={humanize(sourcePath)}
            seedType={inferFieldType(sourcePath, sourceType)}
            onCancel={() => setCreating(false)}
            onCreated={(fieldKey) => {
              setCreating(false)
              onAssign(fieldKey)
            }}
          />
        </PopoverContent>
      </Popover>
    </>
  )
}

/**
 * Inline "name + type" create form over the same {@link useCustomFieldMutations}
 * the dynamic-table create-field flow uses (plan decision 8). A custom field's
 * key equals its name, so the created field is bound immediately by name.
 */
function QuickCreateFieldForm({
  entityDefinitionId,
  seedName,
  seedType,
  onCancel,
  onCreated,
}: {
  entityDefinitionId: string
  seedName: string
  seedType: FieldTypeType
  onCancel: () => void
  onCreated: (fieldKey: string) => void
}) {
  const [name, setName] = useState(seedName)
  const [type, setType] = useState<FieldTypeType>(seedType)
  const { create } = useCustomFieldMutations({ entityDefinitionId })

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const field = await create.mutateAsync({ entityDefinitionId, name: trimmed, type })
    // Custom-field key === name (see useCustomFieldMutations serverField).
    onCreated(field.name)
  }

  return (
    <div className='flex flex-col gap-2'>
      <span className='text-xs font-medium uppercase text-muted-foreground'>New field</span>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder='Field name'
        className='w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring'
      />
      <Select value={type} onValueChange={(v) => setType(v as FieldTypeType)}>
        <SelectTrigger size='sm' className='h-7 text-xs'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUICK_CREATE_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className='flex justify-end gap-1.5'>
        <Button variant='ghost' size='xs' onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant='outline'
          size='xs'
          loading={create.isPending}
          loadingText='Creating…'
          onClick={() => void submit()}>
          Create
        </Button>
      </div>
    </div>
  )
}
