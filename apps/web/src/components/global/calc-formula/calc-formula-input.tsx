// apps/web/src/components/global/calc-formula/calc-formula-input.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { getAvailableFunctions } from '@auxx/utils/calc-expression'
import { EditorContent } from '@tiptap/react'
import { AlertCircle, HelpCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { InlinePickerPopover, useActivePicker } from '~/components/editor/inline-picker'
import type { CalcTokenSource } from './token-source'
import { useCalcFormula } from './use-calc-formula'

interface CalcFormulaInputProps {
  /** Initial expression (the editor is uncontrolled after mount; changes flow via onChange). */
  expression: string
  /** Emits the new expression + the tokens it references on every edit. */
  onChange: (expression: string, extractedTokens: string[]) => void
  /** The single consumer-specific seam (badge + `{` picker body). */
  tokenSource: CalcTokenSource
  placeholder?: string
  /** Optional header label above the editor (rendered with the functions-help button). */
  label?: string
  /** Show a "Functions" help popover button in the header (default false). */
  showFunctionsHelp?: boolean
}

/**
 * The reusable calc-formula editor heart: a TipTap box whose `{` opens an inline
 * token + functions picker, with inline validation. Everything consumer-specific
 * (what a token is, how its chip renders, what the picker lists) is supplied via
 * {@link CalcTokenSource}; the surrounding chrome (a target picker, a result-type
 * selector, a Save button) is composed by the consumer around this component.
 */
export function CalcFormulaInput({
  expression,
  onChange,
  tokenSource,
  placeholder = 'Type { to insert a field, e.g., concat({firstName}, " ", {lastName})',
  label,
  showFunctionsHelp = false,
}: CalcFormulaInputProps) {
  const [showFunctions, setShowFunctions] = useState(false)
  const functions = useMemo(() => getAvailableFunctions(), [])

  const { editor, validation, insertField, insertFunction, closePicker } = useCalcFormula({
    initialExpression: expression,
    onExpressionChange: onChange,
    renderBadge: tokenSource.renderBadge,
    placeholder,
  })

  /** Insert a function from the header help popover (not the `{` picker). */
  const handleInsertFunction = (funcName: string) => {
    if (editor) {
      editor.chain().focus().insertContent(`${funcName}(`).run()
      setShowFunctions(false)
    }
  }

  // Drive the picker popover off the open `{` chip.
  const activePicker = useActivePicker(editor)
  const pickerOpen = !!activePicker && activePicker.trigger === '{'
  const query = activePicker?.query ?? ''

  // Show syntax errors, but not the empty-state "Expression is required". The
  // hook's validation is live (driven by the editor), and it returns the
  // "required" sentinel for an empty expression — so that one check covers both
  // the empty gate and the live-vs-initial staleness the prop can't.
  const showError = !validation.isValid && validation.error !== 'Expression is required'

  return (
    <Field>
      {(label || showFunctionsHelp) && (
        <div className='flex items-center justify-between'>
          {label ? <FieldLabel>{label}</FieldLabel> : <span />}
          {showFunctionsHelp && (
            <Popover open={showFunctions} onOpenChange={setShowFunctions}>
              <PopoverTrigger asChild>
                <Button variant='ghost' size='sm'>
                  <HelpCircle className='size-4 mr-1' />
                  Functions
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-96 max-h-80 overflow-y-auto' align='end'>
                <div className='space-y-2'>
                  <h4 className='font-medium text-sm'>Available Functions</h4>
                  <p className='text-xs text-muted-foreground mb-2'>
                    Click to insert at cursor position
                  </p>
                  {functions.map((fn) => (
                    <div
                      key={fn.name}
                      className='p-2 border rounded hover:bg-muted cursor-pointer'
                      onClick={() => handleInsertFunction(fn.name)}>
                      <div className='font-mono text-sm text-primary-900'>{fn.signature}</div>
                      <div className='text-xs text-muted-foreground'>{fn.description}</div>
                      <div className='text-xs text-muted-foreground mt-1'>
                        Example: <code className='bg-muted px-1 rounded'>{fn.example}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* TipTap editor with the `{` picker popover */}
      <div
        className={cn(
          'relative border rounded-md bg-background',
          showError && 'border-destructive'
        )}>
        <EditorContent editor={editor} className='min-h-[80px]' />
      </div>

      {editor && (
        <InlinePickerPopover
          state={{
            isOpen: pickerOpen,
            query,
            range: null,
            clientRect: activePicker?.clientRect ?? null,
          }}
          width={320}
          onClose={closePicker}>
          {tokenSource.renderPickerItems({
            query,
            onSelect: insertField,
            insertFunction,
            onClose: closePicker,
          })}
        </InlinePickerPopover>
      )}

      {showError && (
        <div className='flex items-center gap-1 text-sm text-destructive mt-1'>
          <AlertCircle className='size-4' />
          {validation.error}
        </div>
      )}

      <FieldDescription>
        Type <kbd className='px-1 bg-muted rounded text-xs'>{'{'}</kbd> to insert a field reference.
        Use functions like concat(), add(), multiply().
      </FieldDescription>
    </Field>
  )
}
