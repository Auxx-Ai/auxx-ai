// apps/web/src/components/workflow/ui/input-editor/var-editor.tsx

import { getDefaultValueForType } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'

import { EditorContent } from '@tiptap/react'
import { ChevronsLeftRightEllipsis, X } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { InlinePickerPopover } from '~/components/editor/inline-picker'
import { Tooltip } from '~/components/global/tooltip'
import { type UnifiedVariable, VAR_MODE } from '~/components/workflow/types'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import {
  VariableTagContextMenu,
  VariableTagDropdown,
} from '~/components/workflow/ui/variables/variable-tag-context-menu'
import { containsVariableReference } from '~/components/workflow/utils/variable-utils'
import { VariableExplorerEnhanced } from '../variables/variable-explorer-enhanced'
import VariableTag from '../variables/variable-tag'
import { ConstantInputAdapter as ConstantInput } from './constant-input-adapter'
import { useWorkflowVariableEditor } from './hooks/use-workflow-variable-editor'
import type { VarEditorProps, VarEditorValue } from './types'

const VarEditor: React.FC<VarEditorProps> = React.memo(
  ({
    value,
    onChange,
    disabled = false,
    readOnly = false,
    nodeId,
    className,
    placeholder = 'Start typing',
    placeholderConstant = 'Enter value',
    varType,
    allowConstant = true,
    allowVariable = true,
    fieldOptions, // Full field.options for type-specific config (enum via fieldOptions.enum, fieldReference via fieldOptions.fieldReference)
    allowedTypes = [], // Type filtering
    mode = VAR_MODE.RICH,
    isConstantMode: controlledIsConstantMode,
    onConstantModeChange,
    defaultIsConstantMode = false,
    hideClearButton = false,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null)

    // Variable mode always holds string content (a variable id or Tiptap text);
    // only constant mode can carry a typed non-string value.
    const textValue = typeof value === 'string' ? value : ''

    // Determine if controlled
    const isControlled = controlledIsConstantMode !== undefined

    // Internal state for uncontrolled mode
    const [internalIsConstantMode, setInternalIsConstantMode] = useState(defaultIsConstantMode)

    // Use controlled value if provided, otherwise internal. Force constant when variables disabled.
    const isConstantMode = !allowVariable
      ? true
      : isControlled
        ? controlledIsConstantMode
        : internalIsConstantMode

    const [constantValue, setConstantValue] = useState<VarEditorValue>(value ?? '')

    // Track previous constant values for each data type to allow restoration
    const [previousConstantValues, setPreviousConstantValues] = useState<
      Record<string, VarEditorValue>
    >({})

    const expectedTypes = varType ? (Array.isArray(varType) ? varType : [varType]) : []

    // Merge varType and allowedTypes for comprehensive filtering
    const finalAllowedTypes = allowedTypes.length > 0 ? allowedTypes : expectedTypes

    const {
      editor,
      suggestionState,
      insertVariable,
      closePicker,
      getStringContent,
      setContent,
      flushPendingChanges,
      isFocused,
    } = useWorkflowVariableEditor({
      initialContent: isConstantMode ? '' : textValue,
      onContentChange: isConstantMode ? undefined : (content) => onChange?.(content, false),
      expectedTypes: finalAllowedTypes,
      placeholder,
      nodeId,
      editable: !disabled && !readOnly,
    })

    // Get string content for comparison
    const stringContent = getStringContent()

    // Handle ConstantInput changes
    const handleConstantInputChange = useCallback(
      (content: string, value: any) => {
        setConstantValue(content)
        onChange?.(value, true)
      },
      [onChange]
    )

    // Stable handler for mode toggle
    const handleToggleMode = useCallback(() => {
      const newMode = !isConstantMode
      const currentVarType = Array.isArray(varType) ? varType[0] : varType

      // Update internal state if uncontrolled
      if (!isControlled) {
        setInternalIsConstantMode(newMode)
      }

      // Call the mode change callback
      onConstantModeChange?.(newMode)

      if (isConstantMode) {
        // Switching from constant to variable mode
        // Store current constant value for future restoration
        if (constantValue && currentVarType) {
          setPreviousConstantValues((prev) => ({
            ...prev,
            [currentVarType]: constantValue,
          }))
        }

        // Clear variable editor and set empty value
        setTimeout(() => {
          setContent('')
          onChange?.('', false)
        }, 0)
      } else {
        // Switching from variable to constant mode
        let newConstantValue: VarEditorValue = ''

        if (containsVariableReference(stringContent)) {
          // Current value contains variable references, use previous constant or type-appropriate default
          const typeKey = currentVarType || 'default'
          newConstantValue =
            previousConstantValues[typeKey] || String(getDefaultValueForType(currentVarType))
        } else {
          // Current value appears to be valid constant data, use it
          newConstantValue = stringContent
        }

        setConstantValue(newConstantValue)
        onChange?.(newConstantValue, true)
      }
    }, [
      isConstantMode,
      isControlled,
      constantValue,
      stringContent,
      varType,
      setContent,
      onChange,
      onConstantModeChange,
      previousConstantValues,
    ])

    const handleClearContent = useCallback(() => {
      if (isConstantMode) {
        setConstantValue('')
        onChange?.('', true)
      } else {
        // Defer the content update to avoid flushSync during render
        setTimeout(() => {
          setContent('')
          onChange?.('', false)
        }, 0)
      }
    }, [isConstantMode, setContent, onChange])

    // Sync value changes with constantValue
    // biome-ignore lint/correctness/useExhaustiveDependencies: constantValue is intentionally excluded to avoid infinite loop
    useEffect(() => {
      if (value !== undefined && value !== constantValue) {
        setConstantValue(value)
      }
    }, [value])

    useEffect(() => {
      if (editor && nodeId !== undefined) {
        editor.storage.nodeId = nodeId
      }
    }, [editor, nodeId])

    // Handle component unmount - flush any pending changes
    React.useEffect(() => {
      return () => {
        flushPendingChanges()
      }
    }, [flushPendingChanges])

    const showReadOnlyOverlay = disabled || readOnly

    // Handle variable selection in picker mode
    const handleVariableSelect = useCallback(
      (variable: UnifiedVariable) => {
        // Defer the content update to avoid flushSync during render
        setTimeout(() => {
          setContent(variable.id || '')
          onChange?.(variable.id || '', false)
        }, 0)
      },
      [onChange, setContent]
    )

    // Handle variable ID change from context menu (e.g., array accessor update)
    const handleVariableIdChange = useCallback(
      (newId: string) => {
        setTimeout(() => {
          setContent(newId)
          onChange?.(newId, false)
        }, 0)
      },
      [onChange, setContent]
    )

    return (
      <div
        ref={containerRef}
        className={cn(
          'group/editor input-editor-wrapper relative flex min-h-8 items-start gap-0.5 flex-1 shrink-0 items-stretch',
          showReadOnlyOverlay && 'opacity-50 cursor-not-allowed',
          className
        )}
        data-focused={isFocused}
        data-readonly={readOnly}>
        {!readOnly && allowConstant && allowVariable && (
          <Tooltip content={isConstantMode ? 'Switch to variable mode' : 'Switch to constant'}>
            <Button
              variant='ghost'
              size='icon-xs'
              className='shrink-0 hover:bg-primary-200 mt-1'
              onClick={handleToggleMode}
              disabled={disabled || readOnly}>
              {isConstantMode ? (
                <span className='text-xs text-primary-500'>C</span>
              ) : (
                <ChevronsLeftRightEllipsis />
              )}
            </Button>
          </Tooltip>
        )}
        {isConstantMode ? (
          <ConstantInput
            value={constantValue}
            onChange={handleConstantInputChange}
            varType={varType}
            fieldOptions={fieldOptions}
            placeholder={placeholderConstant}
            disabled={disabled || readOnly}
            // className='flex-1'
          />
        ) : mode === VAR_MODE.PICKER ? (
          <VariablePicker
            nodeId={nodeId}
            onVariableSelect={handleVariableSelect}
            value={textValue}
            allowedTypes={finalAllowedTypes}
            popoverWidth={400}
            popoverHeight={500}>
            <div className='w-full h-8 flex items-center'>
              {textValue ? (
                <VariableTagDropdown
                  variableId={textValue}
                  onVariableIdChange={handleVariableIdChange}>
                  <VariableTagContextMenu
                    variableId={textValue}
                    onVariableIdChange={handleVariableIdChange}>
                    <VariableTag
                      variableId={textValue}
                      nodeId={nodeId}
                      isShort
                      onVariableIdChange={handleVariableIdChange}
                    />
                  </VariableTagContextMenu>
                </VariableTagDropdown>
              ) : (
                <span className='text-sm text-primary-400 truncate pointer-events-none'>
                  {placeholder}
                </span>
              )}
            </div>
          </VariablePicker>
        ) : (
          <EditorContent
            editor={editor}
            className='input-editor-field flex-1 w-full pt-[6.5px] pb-[4px] focus:outline-none focus:ring-0 h-full [&>*:first-child]:focus:outline-none'
          />
        )}

        {/* Variable picker popover for rich mode */}
        <InlinePickerPopover
          state={suggestionState}
          containerRef={containerRef}
          onClose={closePicker}
          width={400}>
          <VariableExplorerEnhanced
            nodeId={nodeId}
            onVariableSelect={(variable) => insertVariable(variable.id)}
            allowedTypes={finalAllowedTypes}
            className='max-h-[400px]'
            placeholder='Type in editor to filter...'
            onClose={closePicker}
          />
        </InlinePickerPopover>

        {!readOnly &&
          !hideClearButton &&
          (isConstantMode ? constantValue !== '' : stringContent !== '') && (
            <div className='pt-1 px-1 h-full'>
              <Tooltip content={'Clear content'}>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  className='size-4 bg-primary-500/30 text-primary-100 transition-color hover:bg-bad-100 hover:text-bad-500'
                  onClick={handleClearContent}>
                  <X className='size-3!' />
                </Button>
              </Tooltip>
            </div>
          )}

        {/* Read-only overlay to prevent interaction */}
        {showReadOnlyOverlay && <div className='absolute inset-0 z-10' />}
      </div>
    )
  }
)

export { VarEditor }
export type { VarEditorValue } from './types'

/**
 * Narrow a {@link VarEditorValue} to the string form a text/id field expects.
 *
 * Constant-mode inputs hand back the native value for their `BaseType` — a
 * number, a boolean, an enum array, an address object — so a field stored as a
 * string has to serialise it. This mirrors `ConstantInputAdapter`'s own
 * content serialisation so both sides agree.
 */
export function varEditorText(value: VarEditorValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * @deprecated Moved to `~/components/global/forms/field-panel` as FieldPanel / FieldPanelRow.
 * Import from there in new code; these aliases exist so existing imports keep working.
 */
export {
  FieldPanel as VarEditorField,
  FieldPanelRow as VarEditorFieldRow,
} from '~/components/global/forms/field-panel'
