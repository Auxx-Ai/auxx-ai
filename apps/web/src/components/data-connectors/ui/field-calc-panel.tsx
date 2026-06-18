// apps/web/src/components/data-connectors/ui/field-calc-panel.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { getAvailableFunctions, validateCalcExpression } from '@auxx/utils/calc-expression'
import { AlertCircle, FunctionSquare } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { SourcePath } from '../hooks/use-source-paths'

interface FieldCalcPanelProps {
  /** The target field label this expression produces. */
  fieldLabel: string
  /** Current calc expression (over source tokens, e.g. `concat({a}," ",{b})`). */
  expression: string
  /** Source schema paths offered as `{token}` inserts. */
  sourcePaths: SourcePath[]
  /** Persist the expression + the source fields it references. */
  onSave: (expression: string, sourceFields: Record<string, string>) => void
}

/**
 * The lone mapping drill — the calc expression editor (05 §4). A value row's `ƒ`
 * promotes here. The token picker lists SOURCE-schema paths (not target fields),
 * the function set comes from `@auxx/utils/calc-expression`, and output is the
 * target field. Stored uniformly as `{ expression, sourceFields }`.
 *
 * Implementation note: this uses a plain textarea + insert buttons (not the
 * entity-coupled TipTap `CalcFieldEditor`/`FieldBadge`, which resolves tokens
 * against an entity def). That keeps the connector route free of the entity
 * field-picker coupling while reusing the shared calc function set + validator.
 */
export function FieldCalcPanel({
  fieldLabel,
  expression,
  sourcePaths,
  onSave,
}: FieldCalcPanelProps) {
  const [value, setValue] = useState(expression)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const functions = useMemo(() => getAvailableFunctions(), [])

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

  const handleSave = () => {
    const fields: Record<string, string> = {}
    for (const path of validation.extractedFields) fields[path] = path
    onSave(value, fields)
  }

  return (
    <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
      <div className='flex flex-col gap-5 p-4'>
        <Field>
          <FieldLabel>Expression for “{fieldLabel}”</FieldLabel>
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

        <Button className='self-start' onClick={handleSave}>
          Save expression
        </Button>
      </div>
    </ScrollArea>
  )
}
