// apps/web/src/components/data-connectors/ui/field-calc-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { validateCalcExpression } from '@auxx/utils/calc-expression'
import { ChevronDown, Hash } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  CalcFormulaInput,
  type CalcTokenSource,
  CalcTokensUsed,
  FunctionsPickerGroup,
} from '~/components/global/calc-formula'
import { FieldPicker } from '~/components/pickers/field-picker'
import type { SourcePath } from '../hooks/use-source-paths'
import { isSourceTargetCompatible, isWritableTarget } from './field-type-compat'
import { SourcePathBadge } from './source-path-badge'

interface FieldCalcPanelProps {
  /** The mapping's def — the source of selectable target fields. Null only if unset. */
  entityDefinitionId: string | null
  /** The target field this expression writes into (`''` while creating). */
  targetKey: string
  /** Resolved label for the current target field (for the trigger chip). */
  targetLabel: string
  /** Target field keys already bound elsewhere (leaf or formula) — excluded from the picker. */
  excludeKeys: string[]
  /** Current calc expression (over source tokens, e.g. `concat({a}," ",{b})`). */
  expression: string
  /** Source schema paths offered as `{token}` inserts (subtree-relative). */
  sourcePaths: SourcePath[]
  /** Persist the chosen target field + expression + the source fields it references. */
  onSave: (targetKey: string, expression: string, sourceFields: Record<string, string>) => void
}

/**
 * The lone mapping drill — the calc expression editor (05 §4). A formula row (or
 * the "+ Add formula" row) opens this. The canonical {@link FieldPicker} picks
 * which target field the expression writes into (so the panel handles both
 * create and retarget), excluding fields already bound by another leaf/formula.
 *
 * The expression itself uses the shared {@link CalcFormulaInput} (the same TipTap
 * editor as custom-fields CALC fields) backed by a **source-path** token source:
 * tokens are subtree-relative schema paths (`customer.email`), not entity fields,
 * so the chip resolves nothing and the `{` picker lists source paths. Stored
 * uniformly as `{ expression, sourceFields }` keyed by the target field, with
 * `sourceFields` an identity `path → path` map.
 */
export function FieldCalcPanel({
  entityDefinitionId,
  targetKey,
  targetLabel,
  excludeKeys,
  expression,
  sourcePaths,
  onSave,
}: FieldCalcPanelProps) {
  const [value, setValue] = useState(expression)
  const [target, setTarget] = useState(targetKey)
  const [targetChip, setTargetChip] = useState(targetLabel)
  const [pickerOpen, setPickerOpen] = useState(false)
  const excludeSet = useMemo(() => new Set(excludeKeys), [excludeKeys])

  const validation = useMemo(() => {
    if (!value.trim()) return { isValid: true, extractedFields: [] as string[] }
    return validateCalcExpression(value)
  }, [value])

  // The token source: source-schema paths. Badge is purely presentational; the
  // `{` picker is a flat path list followed by the shared functions group.
  const tokenSource: CalcTokenSource = useMemo(
    () => ({
      renderBadge: (id, selected) => <SourcePathBadge path={id} selected={selected} />,
      renderPickerItems: ({ onSelect, insertFunction, onClose }) => (
        <Command>
          <CommandInput placeholder='Search source fields or functions…' />
          <CommandList>
            <CommandEmpty>No source fields.</CommandEmpty>
            {sourcePaths.length > 0 && (
              <CommandGroup heading='Source fields'>
                {sourcePaths.map((p) => (
                  <CommandItem
                    key={p.path}
                    value={p.path}
                    onSelect={() => {
                      onSelect(p.path)
                      onClose()
                    }}>
                    <Hash className='size-3.5 text-muted-foreground' />
                    <span className='font-mono text-sm'>{p.path}</span>
                    <span className='ml-auto text-[10px] uppercase text-muted-foreground/60'>
                      {p.type}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <FunctionsPickerGroup search='' onSelect={insertFunction} />
          </CommandList>
        </Command>
      ),
    }),
    [sourcePaths]
  )

  const canSave = !!target && validation.isValid && !!value.trim()
  const handleSave = () => {
    if (!canSave) return
    // Connectors store sourceFields as an identity map (token path → source path).
    const fields: Record<string, string> = {}
    for (const path of validation.extractedFields) fields[path] = path
    onSave(target, value, fields)
  }

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
      <div className='flex flex-col gap-5 p-4'>
        <Field>
          <FieldLabel>Writes into</FieldLabel>
          <FieldPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            entityDefinitionId={entityDefinitionId ?? ''}
            excludeFields={[FieldType.RELATIONSHIP]}
            // A formula yields a scalar (string/number) — exclude already-bound
            // targets and any field type a computed value can't populate.
            filterField={(f) =>
              !excludeSet.has(f.key) &&
              isWritableTarget(f) &&
              isSourceTargetCompatible(f.fieldType, 'string')
            }
            mode='single'
            searchPlaceholder='Search fields…'
            onSelect={(_ref, field) => {
              setTarget(field.key)
              setTargetChip(field.label)
            }}
            trigger={
              <Button
                variant='outline'
                size='sm'
                className={`justify-between ${target ? '' : 'text-muted-foreground'}`}>
                <span className='truncate'>{target ? targetChip : 'Pick a target field…'}</span>
                <ChevronDown className='size-4 opacity-50' />
              </Button>
            }
          />
        </Field>

        <CalcFormulaInput
          expression={expression}
          onChange={(expr) => setValue(expr)}
          tokenSource={tokenSource}
          label='Expression'
          placeholder='concat({first_name}, " ", {last_name})'
        />

        {sourcePaths.length === 0 && (
          <span className='text-xs text-muted-foreground'>
            No source schema yet — generate one in the stream first.
          </span>
        )}

        <CalcTokensUsed
          tokens={validation.extractedFields}
          tokenSource={tokenSource}
          label='Source fields used'
        />

        <Button className='self-start' disabled={!canSave} onClick={handleSave}>
          Save expression
        </Button>
      </div>
    </ScrollArea>
  )
}
