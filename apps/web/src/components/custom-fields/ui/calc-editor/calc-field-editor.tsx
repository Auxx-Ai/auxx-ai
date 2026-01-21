// apps/web/src/components/custom-fields/ui/calc-editor/calc-field-editor.tsx
'use client'

import { useState, useMemo } from 'react'
import { EditorContent } from '@tiptap/react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@auxx/ui/components/select'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { FieldGroup, Field, FieldLabel, FieldDescription } from '@auxx/ui/components/field'
import { AlertCircle, HelpCircle } from 'lucide-react'
import { getAvailableFunctions } from '@auxx/utils/calc-expression'
import { cn } from '@auxx/ui/lib/utils'
import { useCalcFormula } from './use-calc-formula'
import type { FieldType } from '@auxx/database/types'

/** Options for a CALC field stored in field.options.calc */
export interface CalcEditorOptions {
  expression: string
  sourceFields: Record<string, string> // Record<placeholderKey, fieldId>
  resultFieldType: FieldType
  disabled?: boolean
  disabledReason?: string
}

/** Props for CalcFieldEditor */
interface CalcFieldEditorProps {
  /** Current calc options */
  options: CalcEditorOptions
  /** Callback when options change */
  onChange: (options: CalcEditorOptions) => void
  /** Available fields to reference in the expression */
  availableFields: Array<{ key: string; label: string; type: string; id: string }>
}

/**
 * Editor component for CALC field configuration.
 * Uses TipTap editor with field picker for formula input.
 */
export function CalcFieldEditor({ options, onChange, availableFields }: CalcFieldEditorProps) {
  const [showFunctions, setShowFunctions] = useState(false)
  const functions = useMemo(() => getAvailableFunctions(), [])

  // Build a mapping from field key to field id for storage
  const fieldKeyToId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const f of availableFields) {
      map[f.key] = f.id
    }
    return map
  }, [availableFields])

  // Use the calc formula hook
  const { editor, validation, missingFields, sourceFields } = useCalcFormula({
    initialExpression: options.expression,
    onExpressionChange: (expression, extractedFields) => {
      // Build sourceFields mapping from field keys to field IDs
      const sourceFieldsMap: Record<string, string> = {}
      for (const key of extractedFields) {
        if (fieldKeyToId[key]) {
          sourceFieldsMap[key] = fieldKeyToId[key]
        }
      }

      onChange({
        ...options,
        expression,
        sourceFields: sourceFieldsMap,
      })
    },
    availableFields: availableFields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    placeholder: 'Type { to insert a field, e.g., concat({firstName}, " ", {lastName})',
  })

  /** Insert function at cursor */
  const handleInsertFunction = (funcName: string) => {
    if (editor) {
      editor.chain().focus().insertContent(`${funcName}(`).run()
      setShowFunctions(false)
    }
  }

  return (
    <FieldGroup className="space-y-4">
      {/* Formula Expression Editor */}
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel>Formula Expression</FieldLabel>
          <Popover open={showFunctions} onOpenChange={setShowFunctions}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                <HelpCircle className="size-4 mr-1" />
                Functions
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 max-h-80 overflow-y-auto" align="end">
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Available Functions</h4>
                <p className="text-xs text-muted-foreground mb-2">Click to insert at cursor position</p>
                {functions.map((fn) => (
                  <div
                    key={fn.name}
                    className="p-2 border rounded hover:bg-muted cursor-pointer"
                    onClick={() => handleInsertFunction(fn.name)}
                  >
                    <div className="font-mono text-sm text-primary">{fn.signature}</div>
                    <div className="text-xs text-muted-foreground">{fn.description}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Example: <code className="bg-muted px-1 rounded">{fn.example}</code>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* TipTap Editor */}
        <div
          className={cn(
            'border rounded-md bg-background',
            !validation.isValid && options.expression && 'border-destructive'
          )}
        >
          <EditorContent editor={editor} className="min-h-[80px]" />
        </div>

        {/* Validation Error */}
        {!validation.isValid && options.expression && (
          <div className="flex items-center gap-1 text-sm text-destructive mt-1">
            <AlertCircle className="size-4" />
            {validation.error}
          </div>
        )}

        <FieldDescription>
          Type <kbd className="px-1 bg-muted rounded text-xs">{'{'}</kbd> to insert a field reference. Use functions
          like concat(), add(), multiply().
        </FieldDescription>
      </Field>

      {/* Source Fields Display */}
      {sourceFields.length > 0 && (
        <Field>
          <FieldLabel>Fields Used</FieldLabel>
          <div className="flex flex-wrap gap-1">
            {sourceFields.map((fieldKey) => {
              const field = availableFields.find((f) => f.key === fieldKey)
              const isMissing = !field
              return (
                <Badge key={fieldKey} variant={isMissing ? 'destructive' : 'secondary'}>
                  {field?.label ?? fieldKey}
                  {isMissing && ' (not found)'}
                </Badge>
              )
            })}
          </div>
          {missingFields.length > 0 && (
            <div className="text-sm text-destructive mt-1">
              Some fields in the expression don&apos;t exist on this entity
            </div>
          )}
        </Field>
      )}

      {/* Result Field Type */}
      <Field>
        <FieldLabel>Result Format</FieldLabel>
        <Select
          value={options.resultFieldType}
          onValueChange={(value: FieldType) =>
            onChange({ ...options, resultFieldType: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TEXT">Text</SelectItem>
            <SelectItem value="NUMBER">Number</SelectItem>
            <SelectItem value="CURRENCY">Currency</SelectItem>
            <SelectItem value="CHECKBOX">Yes/No</SelectItem>
          </SelectContent>
        </Select>
        <FieldDescription>How the calculated result should be formatted for display</FieldDescription>
      </Field>
    </FieldGroup>
  )
}

/** Parse CalcEditorOptions from field options */
export function parseCalcOptions(fieldOptions?: Record<string, unknown>): CalcEditorOptions {
  const calc = fieldOptions?.calc as Partial<CalcEditorOptions> | undefined
  return {
    expression: calc?.expression ?? '',
    sourceFields: calc?.sourceFields ?? {},
    resultFieldType: (calc?.resultFieldType as FieldType) ?? 'TEXT',
    disabled: calc?.disabled,
    disabledReason: calc?.disabledReason,
  }
}

/** Format CalcEditorOptions for storage in field.options */
export function formatCalcOptions(options: CalcEditorOptions): { calc: CalcEditorOptions } {
  return { calc: options }
}
