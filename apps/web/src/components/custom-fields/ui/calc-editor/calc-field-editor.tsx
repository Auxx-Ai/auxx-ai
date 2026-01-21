// apps/web/src/components/custom-fields/ui/calc-editor/calc-field-editor.tsx
'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { EditorContent } from '@tiptap/react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { CommandSeparator, CommandGroup, CommandItem } from '@auxx/ui/components/command'
import { FieldGroup, Field, FieldLabel, FieldDescription } from '@auxx/ui/components/field'
import { EntityIcon } from '@auxx/ui/components/icons'
import { AlertCircle, HelpCircle } from 'lucide-react'
import { getAvailableFunctions } from '@auxx/utils/calc-expression'
import { FieldType } from '@auxx/database/enums'
import { cn } from '@auxx/ui/lib/utils'
import { CommandNavigation } from '@auxx/ui/components/command'
import { useCalcFormula } from './use-calc-formula'
import {
  ResourcePickerInnerContent,
  type ResourcePickerNavigationItem,
} from '~/components/pickers/resource-picker'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import type { FieldReference } from '@auxx/types/field'
import type { ResourceField } from '@auxx/lib/resources/client'

/** Options for a CALC field stored in field.options.calc */
export interface CalcEditorOptions {
  expression: string
  sourceFields: Record<string, string> // Record<placeholderKey, fieldId>
  resultFieldType: FieldTypeType
  disabled?: boolean
  disabledReason?: string
}

/** Props for CalcFieldEditor */
interface CalcFieldEditorProps {
  /** Current calc options */
  options: CalcEditorOptions
  /** Callback when options change */
  onChange: (options: CalcEditorOptions) => void
  /** Entity definition ID for field picker */
  entityDefinitionId: string
  /** Current field ID to exclude from picker (prevent self-reference) */
  currentFieldId?: string
  /** Available fields to reference in the expression (for display and validation) */
  availableFields: Array<{ key: string; label: string; type: string; id: string }>
}

/**
 * Editor component for CALC field configuration.
 * Uses TipTap editor with field picker for formula input.
 */
export function CalcFieldEditor({
  options,
  onChange,
  entityDefinitionId,
  currentFieldId,
  availableFields,
}: CalcFieldEditorProps) {
  const [showFunctions, setShowFunctions] = useState(false)
  const functions = useMemo(() => getAvailableFunctions(), [])
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Build a mapping from field key to field id for storage
  const fieldKeyToId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const f of availableFields) {
      map[f.key] = f.id
    }
    return map
  }, [availableFields])

  // Use the calc formula hook
  const {
    editor,
    validation,
    sourceFields,
    suggestionState,
    insertField,
    insertFunction,
    closeSuggestion,
  } = useCalcFormula({
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
    entityDefinitionId,
    currentFieldId,
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

  /** Handle selecting a field from the picker */
  const handleSelectField = useCallback(
    (_fieldReference: FieldReference, field: ResourceField) => {
      insertField(field.key)
    },
    [insertField]
  )

  /** Handle selecting a function from the picker */
  const handleSelectFunction = useCallback(
    (funcName: string) => {
      insertFunction(funcName)
    },
    [insertFunction]
  )

  // Build exclude filters: exclude RELATIONSHIP and CALC types, plus current field
  const excludeFilters = useMemo(() => {
    const filters: ((typeof FieldType)[keyof typeof FieldType] | string)[] = [
      FieldType.RELATIONSHIP,
      FieldType.CALC,
    ]
    if (currentFieldId) {
      filters.push(`${entityDefinitionId}:${currentFieldId}`)
    }
    return filters
  }, [entityDefinitionId, currentFieldId])

  /** Render functions section filtered by search */
  const renderFunctionsInPicker = useCallback(
    (search: string) => {
      const filteredFunctions = search
        ? functions.filter(
            (f) =>
              f.name.toLowerCase().includes(search.toLowerCase()) ||
              f.description.toLowerCase().includes(search.toLowerCase())
          )
        : functions

      if (filteredFunctions.length === 0) return null

      return (
        <>
          <CommandSeparator />
          <CommandGroup heading="Functions">
            {filteredFunctions.map((fn) => (
              <CommandItem key={fn.name} onSelect={() => handleSelectFunction(fn.name)}>
                <EntityIcon iconId="function" size="xs" className="text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="font-mono text-sm">{fn.signature}</span>
                  <span className="text-xs text-muted-foreground">{fn.description}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )
    },
    [functions, handleSelectFunction]
  )

  // Calculate popover position relative to editor container
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (suggestionState.isOpen && suggestionState.clientRect && editorContainerRef.current) {
      const containerRect = editorContainerRef.current.getBoundingClientRect()
      const cursorRect = suggestionState.clientRect
      setPopoverPosition({
        top: cursorRect.bottom - containerRect.top,
        left: cursorRect.left - containerRect.left,
      })
    }
  }, [suggestionState.isOpen, suggestionState.clientRect])

  // Close picker when clicking outside
  useEffect(() => {
    if (!suggestionState.isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        closeSuggestion()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [suggestionState.isOpen, closeSuggestion])

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
                <p className="text-xs text-muted-foreground mb-2">
                  Click to insert at cursor position
                </p>
                {functions.map((fn) => (
                  <div
                    key={fn.name}
                    className="p-2 border rounded hover:bg-muted cursor-pointer"
                    onClick={() => handleInsertFunction(fn.name)}>
                    <div className="font-mono text-sm text-primary-900">{fn.signature}</div>
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

        {/* TipTap Editor with Field Picker Popover */}
        <div
          ref={editorContainerRef}
          className={cn(
            'relative border rounded-md bg-background',
            !validation.isValid &&
              options.expression.trim() &&
              validation.error !== 'Expression is required' &&
              'border-destructive'
          )}>
          <EditorContent editor={editor} className="min-h-[80px]" />

          {/* Field Picker - positioned at cursor */}
          {suggestionState.isOpen && popoverPosition && (
            <div
              ref={pickerRef}
              className="absolute z-50"
              style={{
                top: popoverPosition.top,
                left: popoverPosition.left,
              }}>
              <div
                className="rounded-lg border bg-popover shadow-lg w-[320px]"
                onMouseDown={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    closeSuggestion()
                  }
                }}>
                <CommandNavigation<ResourcePickerNavigationItem>>
                  <ResourcePickerInnerContent
                    entityDefinitionId={entityDefinitionId}
                    excludeFields={excludeFilters}
                    onSelect={handleSelectField}
                    onClose={closeSuggestion}
                    closeOnSelect
                    showBreadcrumb={false}
                    searchPlaceholder="Search fields or functions..."
                    renderAdditionalContent={renderFunctionsInPicker}
                  />
                </CommandNavigation>
              </div>
            </div>
          )}
        </div>

        {/* Validation Error - only show for actual syntax errors, not empty state */}
        {!validation.isValid &&
          options.expression.trim() &&
          validation.error !== 'Expression is required' && (
            <div className="flex items-center gap-1 text-sm text-destructive mt-1">
              <AlertCircle className="size-4" />
              {validation.error}
            </div>
          )}

        <FieldDescription>
          Type <kbd className="px-1 bg-muted rounded text-xs">{'{'}</kbd> to insert a field
          reference. Use functions like concat(), add(), multiply().
        </FieldDescription>
      </Field>

      {/* Source Fields Display - only show when there are actual field references */}
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
        </Field>
      )}

      {/* Result Field Type */}
      <Field>
        <FieldLabel>Result Format</FieldLabel>
        <Select
          value={options.resultFieldType}
          onValueChange={(value: FieldTypeType) =>
            onChange({ ...options, resultFieldType: value })
          }>
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
        <FieldDescription>
          How the calculated result should be formatted for display
        </FieldDescription>
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
    resultFieldType: (calc?.resultFieldType as FieldTypeType) ?? 'TEXT',
    disabled: calc?.disabled,
    disabledReason: calc?.disabledReason,
  }
}

/** Format CalcEditorOptions for storage in field.options */
export function formatCalcOptions(options: CalcEditorOptions): { calc: CalcEditorOptions } {
  return { calc: options }
}
