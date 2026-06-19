// apps/web/src/components/global/calc-formula/calc-formula-input.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { Kbd } from '@auxx/ui/components/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { TooltipError } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import { getAvailableFunctions } from '@auxx/utils/calc-expression'
import { EditorContent } from '@tiptap/react'
import { HelpCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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

  const {
    editor,
    expression: liveExpression,
    validation,
    insertField,
    insertFunction,
    closePicker,
  } = useCalcFormula({
    initialExpression: expression,
    onExpressionChange: onChange,
    renderBadge: tokenSource.renderBadge,
    placeholder,
  })

  // Debounce error surfacing: while the user is actively typing we don't want to
  // flash transient parse errors (e.g. "Unexpected end of expression" the moment
  // they type `concat(`). `settled` only catches up to the live expression after
  // a typing pause, so errors appear once they stop — not on every keystroke. A
  // pre-existing invalid expression still shows immediately (settled == live on mount).
  const [settled, setSettled] = useState(liveExpression)
  useEffect(() => {
    const t = setTimeout(() => setSettled(liveExpression), 500)
    return () => clearTimeout(t)
  }, [liveExpression])
  const hasSettled = settled === liveExpression

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
  const showError =
    hasSettled && !validation.isValid && validation.error !== 'Expression is required'

  return (
    <Field>
      {(label || showFunctionsHelp || showError) && (
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-1.5'>
            {label ? <FieldLabel>{label}</FieldLabel> : <span />}
            {showError && <TooltipError text={validation.error ?? ''} size='sm' />}
          </div>
          {showFunctionsHelp && (
            <Popover open={showFunctions} onOpenChange={setShowFunctions}>
              <PopoverTrigger asChild>
                <Button variant='ghost' size='sm'>
                  <HelpCircle className='size-4 mr-1' />
                  Functions
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-96 p-0' align='end'>
                <Command>
                  <CommandInput placeholder='Search functions…' />
                  <CommandList className='max-h-80'>
                    <CommandEmpty>No functions found.</CommandEmpty>
                    <CommandGroup>
                      <CommandGroupLabel>Available functions</CommandGroupLabel>
                      {functions.map((fn) => (
                        <CommandItem
                          key={fn.name}
                          value={`${fn.name} ${fn.description}`}
                          onSelect={() => handleInsertFunction(fn.name)}
                          className='flex-col items-start gap-0.5 rounded-md'>
                          <span className='font-mono text-sm text-primary-900'>{fn.signature}</span>
                          <span className='text-xs text-muted-foreground'>{fn.description}</span>
                          <span className='text-xs text-muted-foreground'>
                            Example: <code className='bg-muted px-1 rounded'>{fn.example}</code>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {/* TipTap editor with the `{` picker popover */}
      <div
        className={cn(
          'relative flex flex-col rounded-md border bg-background px-0 py-1',
          showError && 'border-destructive'
        )}>
        <EditorContent
          editor={editor}
          className='flex flex-1 flex-col min-h-[80px] [&_.ProseMirror]:flex-1'
        />
        <div className='flex text-sm gap-1 text-muted-foreground px-2 py-1'>
          Type <Kbd variant='outline'>{'{'}</Kbd> to insert a field, or use functions like concat().
        </div>
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
    </Field>
  )
}
