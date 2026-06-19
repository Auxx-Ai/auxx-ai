// apps/web/src/components/data-connectors/ui/field-calc-panel.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { getAvailableFunctions, validateCalcExpression } from '@auxx/utils/calc-expression'
import { AlertCircle, ChevronDown, FunctionSquare } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { FieldPicker } from '~/components/pickers/field-picker'
import type { SourcePath } from '../hooks/use-source-paths'
import { isSourceTargetCompatible } from './field-type-compat'

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
  /** Source schema paths offered as `{token}` inserts. */
  sourcePaths: SourcePath[]
  /** Persist the chosen target field + expression + the source fields it references. */
  onSave: (targetKey: string, expression: string, sourceFields: Record<string, string>) => void
}

/**
 * The lone mapping drill — the calc expression editor (05 §4). A formula row (or
 * the "+ Add formula" row) opens this. The canonical {@link FieldPicker} picks
 * which target field the expression writes into (so the panel handles both
 * create and retarget), excluding fields already bound by another leaf/formula;
 * the token picker lists SOURCE-schema paths (not target fields), the function
 * set comes from `@auxx/utils/calc-expression`, and output is the target field.
 * Stored uniformly as `{ expression, sourceFields }` keyed by the target field.
 *
 * Implementation note: this uses a plain textarea + insert buttons (not the
 * entity-coupled TipTap `CalcFieldEditor`/`FieldBadge`, which resolves tokens
 * against an entity def). That keeps the connector route free of the entity
 * field-picker coupling while reusing the shared calc function set + validator.
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
  const taRef = useRef<HTMLTextAreaElement>(null)
  const functions = useMemo(() => getAvailableFunctions(), [])
  const excludeSet = useMemo(() => new Set(excludeKeys), [excludeKeys])

  const validation = useMemo(() => {
    if (!value.trim()) return { isValid: true, extractedFields: [] as string[], error: undefined }
    return validateCalcExpression(value)
  }, [value])

  const insertAtCursor = (text: string) => {
    const ta = taRef.current
    if (!ta) {
      setValue((v) => v + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = value.slice(0, start) + text + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + text.length
    })
  }

  const canSave = !!target && validation.isValid && !!value.trim()
  const handleSave = () => {
    if (!canSave) return
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
            entityDefinitionId={entityDefinitionId}
            excludeFields={[FieldType.RELATIONSHIP]}
            // A formula yields a scalar (string/number) — exclude already-bound
            // targets and any field type a computed value can't populate.
            filterField={(f) =>
              !excludeSet.has(f.key) && isSourceTargetCompatible(f.fieldType, 'string')
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

        <Field>
          <FieldLabel>Expression</FieldLabel>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='concat({first_name}, " ", {last_name})'
            className='min-h-[88px] w-full rounded-md border bg-background p-2 font-mono text-sm outline-none focus:ring-1 focus:ring-ring'
          />
          {!validation.isValid && value.trim() && (
            <div className='mt-1 flex items-center gap-1 text-sm text-destructive'>
              <AlertCircle className='size-4' />
              {validation.error}
            </div>
          )}
          <FieldDescription>
            Reference source fields with <code className='rounded bg-muted px-1'>{'{path}'}</code>{' '}
            and combine them with functions.
          </FieldDescription>
        </Field>

        <div className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium uppercase text-muted-foreground'>Source fields</span>
          <div className='flex flex-wrap gap-1'>
            {sourcePaths.length === 0 ? (
              <span className='text-xs text-muted-foreground'>
                No source schema yet — generate one in the stream first.
              </span>
            ) : (
              sourcePaths.map((p) => (
                <Button
                  key={p.path}
                  variant='outline'
                  size='xs'
                  onClick={() => insertAtCursor(`{${p.path}}`)}>
                  {p.path}
                </Button>
              ))
            )}
          </div>
        </div>

        <div className='flex flex-col gap-1.5'>
          <span className='flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground'>
            <FunctionSquare className='size-3.5' />
            Functions
          </span>
          <div className='flex flex-wrap gap-1'>
            {functions.map((fn) => (
              <Button
                key={fn.name}
                variant='ghost'
                size='xs'
                title={`${fn.signature} — ${fn.description}`}
                onClick={() => insertAtCursor(`${fn.name}(`)}>
                {fn.name}
              </Button>
            ))}
          </div>
        </div>

        {validation.extractedFields.length > 0 && (
          <div className='flex flex-wrap gap-1'>
            {validation.extractedFields.map((f) => (
              <Badge key={f} variant='secondary'>
                {f}
              </Badge>
            ))}
          </div>
        )}

        <Button className='self-start' disabled={!canSave} onClick={handleSave}>
          Save expression
        </Button>
      </div>
    </ScrollArea>
  )
}
