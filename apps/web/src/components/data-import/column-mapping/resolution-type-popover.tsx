// apps/web/src/components/data-import/column-mapping/resolution-type-popover.tsx

'use client'

import {
  getResolutionTypeLabel,
  getValidResolutionTypes,
  type ImportableField,
  type ResolutionType,
} from '@auxx/lib/import/client'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import { Binary } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'

/** A column's decimal separator choice. `null` is per-cell detection. */
export type DecimalSeparatorChoice = '.' | ',' | null

interface ResolutionTypePopoverProps {
  /** The field this column is mapped to. */
  field: ImportableField
  /** The column's stored resolution type. */
  value: string
  /** The column's stored decimal separator, when one was chosen. */
  decimalSeparator: string | null
  /** Disables the control while a save is in flight. */
  disabled?: boolean
  onChange: (next: ResolutionType) => void
  onDecimalSeparatorChange: (next: DecimalSeparatorChoice) => void
}

/**
 * The valid resolution types for a column, most-appropriate first.
 *
 * Read from `getValidResolutionTypes`, never restated here — it is the same
 * function `suggestResolutionType` agrees with, and its first entry IS the
 * suggestion, so "is this column on its default?" is a comparison rather than a
 * second copy of the rule.
 */
function resolutionChoices(field: ImportableField | undefined): ResolutionType[] {
  // A relation column's type is DERIVED from its policy
  // (`buildRelationColumnPolicy`: match field + `onNoMatch` ⇒
  // `relation:id`/`relation:match`/`relation:create`) and the row already has a
  // control for that policy. A second, direct picker would write a type the very
  // next policy save recomputes away, so relations are deliberately excluded.
  if (!field || field.isRelation) return []
  return getValidResolutionTypes(field)
}

/**
 * Whether this column has a real resolution-type choice to offer.
 *
 * One valid type is not a choice, it is a fact about the field, and a dead
 * control on every row is worse than no control at all.
 */
export function hasResolutionChoice(field: ImportableField | undefined): boolean {
  return resolutionChoices(field).length > 1
}

/**
 * The types whose reading depends on which character marks decimals. A whole
 * number has no decimals to mark and text is imported as written, so the
 * separator is offered only where it changes the answer.
 */
function readsDecimals(type: ResolutionType): boolean {
  return type === 'currency:major' || type === 'number:decimal'
}

const SEPARATOR_OPTIONS: Array<{
  value: 'auto' | '.' | ','
  label: string
  description: string
}> = [
  {
    value: 'auto',
    label: 'Detect per cell',
    description:
      'Point or comma, read from each cell. A lone separator with three digits after it ' +
      '(1.234) is refused as ambiguous.',
  },
  { value: '.', label: 'Point', description: '1,234.56 → 1234.56' },
  { value: ',', label: 'Comma', description: '1.234,56 → 1234.56' },
]

/**
 * How this column's cells are READ, as a per-column choice.
 *
 * This is the control that makes two engine behaviours reachable at all:
 *
 * - `select:value` → `select:create` on an option-bearing field. Option
 *   creation is opt-in **by choosing the type** — that IS the per-column
 *   consent — so without this picker the consent can never be given and an
 *   import can never add the categories its file names.
 * - `currency:major` → `number:integer` on a money field. Both accept `1234`
 *   and they mean $12.34 and $1,234.00. Nothing in the file says which, so the
 *   HINTS carried by `RESOLUTION_TYPE_LABELS` are the entire mechanism by which
 *   a user can tell them apart — which is why they are rendered next to every
 *   option rather than only on the active one.
 *
 * The decimal separator lives here too, for the types that read decimals. The
 * resolver's own error for an ambiguous cell says "set the column's decimal
 * separator", and this is the only place that can.
 *
 * Lives on the mapping ROW next to the identity and policy controls, for the
 * same reason they do: the field picker closes on selection and resets its
 * drill-down, so a control inside it costs a reopen per change.
 */
export function ResolutionTypePopover({
  field,
  value,
  decimalSeparator,
  disabled,
  onChange,
  onDecimalSeparatorChange,
}: ResolutionTypePopoverProps) {
  const [open, setOpen] = useState(false)
  const choices = useMemo(() => resolutionChoices(field), [field])

  // Read before the guard so the guard is what NARROWS it. `choices[0]` is
  // optional under `noUncheckedIndexedAccess`, and the suggestion is the one
  // value here that must never be asserted away — it decides the fallback.
  const suggested = choices[0]
  if (!suggested || choices.length <= 1) return null

  const active = choices.includes(value as ResolutionType) ? (value as ResolutionType) : suggested
  const showSeparator = readsDecimals(active)
  const separator: 'auto' | '.' | ',' =
    showSeparator && (decimalSeparator === '.' || decimalSeparator === ',')
      ? decimalSeparator
      : 'auto'
  const isCustomised = active !== suggested || separator !== 'auto'
  const activeLabel = getResolutionTypeLabel(active)
  const separatorLabel = SEPARATOR_OPTIONS.find((o) => o.value === separator)?.label ?? ''
  const tooltip =
    `Read as: ${activeLabel.label}. ${activeLabel.hint}` +
    (showSeparator && separator !== 'auto' ? ` Decimal separator: ${separatorLabel}.` : '')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={tooltip}>
        <span className='inline-flex'>
          <PopoverTrigger asChild>
            <Button
              variant='outline'
              size='icon-sm'
              aria-label={`How ${field.label} values are read`}
              disabled={disabled}
              className={cn(
                'rounded-none border-r-0 bg-linear-0 shadow-none hover:inset-shadow-none',
                isCustomised ? 'text-info' : 'text-muted-foreground'
              )}
              onClick={(e) => e.stopPropagation()}>
              <Binary />
            </Button>
          </PopoverTrigger>
        </span>
      </Tooltip>
      <PopoverContent className='w-[340px] p-0' align='end' onClick={(e) => e.stopPropagation()}>
        <div className='px-3 py-2 border-b'>
          <p className='text-sm font-medium'>{field.label}</p>
          <p className='text-xs text-muted-foreground'>How this column&rsquo;s values are read</p>
        </div>
        {/* `max-h-*` belongs on the VIEWPORT, not the root — see ScrollArea's own
            note: on the root the viewport grows to its content and never scrolls. */}
        <ScrollArea viewportClassName='max-h-[420px]'>
          <RadioGroup
            value={active}
            className='gap-1.5 p-3'
            onValueChange={(next) => {
              if (next !== active) onChange(next as ResolutionType)
            }}>
            {choices.map((type) => {
              const { label, hint } = getResolutionTypeLabel(type)
              return (
                <RadioGroupItemCard
                  key={type}
                  id={`resolution-${field.key}-${type}`}
                  value={type}
                  label={label}
                  sublabel={type === suggested ? 'suggested' : undefined}
                  description={hint}
                />
              )
            })}
          </RadioGroup>
          {showSeparator && (
            <>
              <div className='px-3 py-2 border-t border-b'>
                <p className='text-sm font-medium'>Decimal separator</p>
                <p className='text-xs text-muted-foreground'>
                  Which character marks decimals in this column
                </p>
              </div>
              <RadioGroup
                value={separator}
                className='gap-1.5 p-3'
                onValueChange={(next) => {
                  if (next === separator) return
                  onDecimalSeparatorChange(next === 'auto' ? null : (next as '.' | ','))
                }}>
                {SEPARATOR_OPTIONS.map((option) => (
                  <RadioGroupItemCard
                    key={option.value}
                    id={`separator-${field.key}-${option.value}`}
                    value={option.value}
                    label={option.label}
                    sublabel={option.value === 'auto' ? 'default' : undefined}
                    description={option.description}
                  />
                ))}
              </RadioGroup>
            </>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
