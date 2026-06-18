// apps/web/src/components/schema-editor/ui/schema-field-edit-card.tsx

import { FieldType } from '@auxx/database/enums'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { Switch } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  type SelectOption as EditorOption,
  OptionsEditor,
} from '~/components/custom-fields/ui/options-editor'
import { Tooltip } from '~/components/global/tooltip'
import { VariableTypePicker } from '~/components/workflow/ui/variable-type-picker'
import {
  canArrayInSchema,
  changeRowType,
  pickerValueFromTypeValue,
  pickerValueOf,
  SCHEMA_EDITOR_EXCLUDED_TYPES,
  typeLabelOf,
  typeValueOf,
} from '../draft-ops'
import type { SchemaFieldDraft, SchemaPolicy } from '../schema-draft'
import { validateFieldName } from '../validation'

interface SchemaFieldEditCardProps {
  row: SchemaFieldDraft
  siblingNames: string[]
  policy: SchemaPolicy
  onChange: (next: SchemaFieldDraft) => void
  onDelete: () => void
  onAddChild: () => void
  onFocusEditing: (editing: boolean) => void
}

/**
 * In-place edit row in SOG's visual language: a `bg-background` card with an
 * inline name input, a ghost type picker, pill toggles for Nullable/Required,
 * an inline description, and (for selects) the resource-style OptionsEditor.
 * Edits write straight through to the draft (the dialog owns Save).
 */
export function SchemaFieldEditCard({
  row,
  siblingNames,
  policy,
  onChange,
  onDelete,
  onAddChild,
  onFocusEditing,
}: SchemaFieldEditCardProps) {
  const nameError = validateFieldName(row.name, siblingNames, policy.freeformNames)
  const isSelect =
    row.fieldType === FieldType.SINGLE_SELECT || row.fieldType === FieldType.MULTI_SELECT
  const isRaw = !!row.raw
  const isContainer = row.kind === 'object' || row.kind === 'array'

  return (
    <div className='flex flex-col rounded-lg bg-background py-0.5 shadow-sm'>
      <div className='flex h-7 items-center pl-1 pr-0.5'>
        <div className='flex min-w-0 grow items-center gap-x-1'>
          <AutosizeInput
            value={row.name}
            placeholder='Field name'
            minWidth={80}
            maxWidth={300}
            onChange={(e) => onChange({ ...row, name: e.target.value })}
            onFocus={() => onFocusEditing(true)}
            onBlur={() => onFocusEditing(false)}
            inputClassName='font-semibold text-sm h-5 rounded-[5px] border border-transparent px-1 py-px text-primary-800 outline-none placeholder:text-primary-400 hover:bg-state-base-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'
          />

          <TypeSelector
            row={row}
            disabled={isRaw}
            onChange={onChange}
            onOpenChange={onFocusEditing}
          />

          {!isRaw && (
            <TogglePill
              label='Nullable'
              checked={row.nullable}
              onChange={(checked) => onChange({ ...row, nullable: checked })}
            />
          )}

          {/* Description sits inline (same autosize input as the name) so the row
              stays a single line — hovering never grows it past its read height. */}
          {!isRaw && (
            <AutosizeInput
              value={row.description ?? ''}
              placeholder='Description'
              minWidth={80}
              maxWidth={260}
              onChange={(e) => onChange({ ...row, description: e.target.value || undefined })}
              onFocus={() => onFocusEditing(true)}
              onBlur={() => onFocusEditing(false)}
              inputClassName='text-xs h-5 rounded-[5px] border border-transparent px-1 py-px text-primary-500 outline-none placeholder:text-primary-400 hover:bg-state-base-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'
            />
          )}

          {nameError && <span className='shrink-0 px-1 text-[10px] text-bad-500'>{nameError}</span>}
        </div>

        {policy.emitRequired && (
          <TogglePill
            label='Required'
            checked={!!row.required}
            onChange={(checked) => onChange({ ...row, required: checked })}
          />
        )}

        <Separator orientation='vertical' className='mx-1 h-3' />
        {isContainer && (
          <Tooltip content='Add child field'>
            <button
              type='button'
              aria-label='Add child field'
              className='flex size-6 items-center justify-center rounded text-tertiary hover:text-primary-500'
              onClick={onAddChild}>
              <Plus className='size-3.5' />
            </button>
          </Tooltip>
        )}
        <button
          type='button'
          aria-label='Delete field'
          className='flex size-6 items-center justify-center rounded text-tertiary hover:text-bad-500'
          onClick={onDelete}>
          <Trash2 className='size-3.5' />
        </button>
      </div>

      {isRaw && (
        <div className='px-2 pb-1 text-[11px] text-muted-foreground italic'>
          Complex schema — edit it in the JSON tab.
        </div>
      )}

      {isSelect && (
        <div className='px-2 pb-1.5'>
          <OptionsEditor
            options={(row.options ?? []).map((o) => ({
              label: o.label,
              value: o.value,
              color: o.color,
            }))}
            onChange={(opts: EditorOption[]) =>
              onChange({
                ...row,
                options: opts.map((o) => ({ label: o.label, value: o.value, color: o.color })),
              })
            }
          />
        </div>
      )}
    </div>
  )
}

/**
 * The shared `VariableTypePicker` (BaseType + Array toggle) behind SOG's ghost
 * trigger — lowercase JSON-Schema label + chevron. The draft row is bridged to
 * the picker's `{ baseType, isArray }` value; the Array toggle only shows for
 * the types the editor can author as arrays (object / enum / string).
 */
function TypeSelector({
  row,
  disabled,
  onChange,
  onOpenChange,
}: {
  row: SchemaFieldDraft
  disabled?: boolean
  onChange: (next: SchemaFieldDraft) => void
  /** Pins the row's edit card open while the picker is open (survives mouseleave). */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const typeValue = typeValueOf(row)
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  return (
    <VariableTypePicker
      value={typeValue}
      onChange={(next) => onChange(changeRowType(row, pickerValueFromTypeValue(next)))}
      excludeTypes={SCHEMA_EDITOR_EXCLUDED_TYPES}
      includeArrayToggle={canArrayInSchema(typeValue.baseType)}
      disabled={disabled}
      open={open}
      onOpenChange={handleOpenChange}
      align='start'
      popoverWidth={208}>
      <Button
        variant='ghost'
        size='xs'
        disabled={disabled}
        className={cn(open && 'bg-state-base-hover')}>
        <span className='system-xs-medium text-primary-500'>{typeLabelOf(pickerValueOf(row))}</span>
        <ChevronDown className='size-4 text-primary-500' />
      </Button>
    </VariableTypePicker>
  )
}

/** SOG's bordered toggle pill (uppercase micro-label + small switch). */
function TogglePill({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className='flex cursor-pointer items-center gap-x-1 rounded-[5px] border border-divider-subtle px-1.5 py-1'>
      <span className='font-normal text-[10px] uppercase'>{label}</span>
      <Switch size='sm' checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
