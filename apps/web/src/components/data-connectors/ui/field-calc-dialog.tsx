// apps/web/src/components/data-connectors/ui/field-calc-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { validateCalcExpression } from '@auxx/utils/calc-expression'
import { Hash } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  CalcFormulaInput,
  type CalcTokenSource,
  CalcTokensUsed,
  FunctionsPickerGroup,
} from '~/components/global/calc-formula'
import type { SourcePath } from '../hooks/use-source-paths'
import { SourcePathBadge } from './source-path-badge'

interface FieldCalcDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolved label for the target field this expression writes into (shown read-only). */
  targetLabel: string
  /** Current calc expression (over source tokens, e.g. `concat({a}," ",{b})`). */
  expression: string
  /** Source schema paths offered as `{token}` inserts (subtree-relative). */
  sourcePaths: SourcePath[]
  /** Persist the expression + the source fields it references. */
  onSave: (expression: string, sourceFields: Record<string, string>) => void
}

/**
 * The calc expression editor (05 §4), opened from a formula row's source button
 * (or after picking a target on the "+ Add formula" row) in the mapping tree. The
 * target field is owned by the row, not this dialog — here you only define how the
 * value is computed.
 *
 * The form body is a separate component rendered inside {@link DialogContent} so
 * Radix unmounts it on close — each open remounts it with fresh state seeded from
 * the props (no stale expression between edits).
 */
export function FieldCalcDialog({ open, onOpenChange, onSave, ...form }: FieldCalcDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Formula</DialogTitle>
          <DialogDescription>
            {form.targetLabel
              ? `Compute ${form.targetLabel} from one or more source fields.`
              : 'Compute the target field from one or more source fields.'}
          </DialogDescription>
        </DialogHeader>
        <CalcForm
          {...form}
          onCancel={() => onOpenChange(false)}
          onSave={(expression, sourceFields) => {
            onSave(expression, sourceFields)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

type CalcFormProps = Omit<FieldCalcDialogProps, 'open' | 'onOpenChange'> & {
  /** Close the dialog without saving (Cancel / esc). */
  onCancel: () => void
}

/**
 * The form body. Uses the shared {@link CalcFormulaInput} (the same TipTap editor
 * as custom-fields CALC fields) backed by a **source-path** token source: tokens
 * are subtree-relative schema paths (`customer.email`), not entity fields, so the
 * chip resolves nothing and the `{` picker lists source paths. Stored uniformly as
 * `{ expression, sourceFields }` keyed by the target field, with `sourceFields` an
 * identity `path → path` map.
 */
function CalcForm({ expression, sourcePaths, onCancel, onSave }: CalcFormProps) {
  const [value, setValue] = useState(expression)

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

  const canSave = validation.isValid && !!value.trim()
  const handleSave = () => {
    if (!canSave) return
    // Connectors store sourceFields as an identity map (token path → source path).
    const fields: Record<string, string> = {}
    for (const path of validation.extractedFields) fields[path] = path
    onSave(value, fields)
  }

  return (
    <div className='flex flex-col '>
      <div className='mb-3'>
        <CalcFormulaInput
          expression={expression}
          onChange={(expr) => setValue(expr)}
          tokenSource={tokenSource}
          label='Expression'
          showFunctionsHelp
          placeholder='concat({first_name}, " ", {last_name})'
        />
      </div>

      {sourcePaths.length === 0 && (
        <span className='text-xs text-muted-foreground mb-3'>
          No source schema yet — generate one in the stream first.
        </span>
      )}
      <CalcTokensUsed
        tokens={validation.extractedFields}
        tokenSource={tokenSource}
        label='Source fields used'
      />

      <DialogFooter>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={!canSave}
          onClick={handleSave}
          data-dialog-submit>
          Save expression <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </div>
  )
}
