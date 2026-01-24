// apps/web/src/components/workflow/ui/input-editor/var-editor.tsx

import React, { useCallback, useEffect, useState, useRef } from 'react'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

import { EditorContent } from '@tiptap/react'
import { type VarEditorProps } from './types'
import { useWorkflowVariableEditor } from './hooks/use-workflow-variable-editor'
import { Button } from '@auxx/ui/components/button'
import { ChevronsLeftRightEllipsis, X } from 'lucide-react'
import { Tooltip, TooltipExplanation } from '~/components/global/tooltip'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'
import { VAR_MODE, BaseType, type UnifiedVariable } from '~/components/workflow/types'
import { containsVariableReference } from '~/components/workflow/utils/variable-utils'
import { getDefaultValueForType } from '@auxx/lib/workflow-engine/client'
import { InlinePickerPopover } from '~/components/editor/inline-picker'
import { VariableExplorerEnhanced } from '../variables/variable-explorer-enhanced'

import VariableTag from '../variables/variable-tag'
import { VarTypeIcon } from '../../utils'
import { ConstantInputAdapter as ConstantInput } from './constant-input-adapter'
import { ValidationErrorBadge } from './validation-error-badge'

/**
 * Variants for VarEditorField orientation
 * Controls how VarEditorFieldRow children lay out their label and content
 */
const varEditorFieldVariants = cva(
  [
    'relative grow rounded-2xl px-1.5 py-0.5',
    'bg-primary-200/30 dark:bg-[#23272e]/30 border flex flex-col focus-within:border-primary-300',
    '[&>[data-slot=field-row]:last-child]:border-b-0',
  ],
  {
    variants: {
      orientation: {
        horizontal: [
          // field-row: horizontal layout (default behavior)
          '[&_[data-slot=field-row]]:flex-row [&_[data-slot=field-row]]:items-start',
          // field-row-label: fixed width and height
          '[&_[data-slot=field-row-label]]:w-40 [&_[data-slot=field-row-label]]:shrink-0 [&_[data-slot=field-row-label]]:min-h-8',
        ],
        vertical: [
          // field-row: vertical layout (stacked)
          '[&_[data-slot=field-row]]:flex-col [&_[data-slot=field-row]]:items-stretch',
          // field-row-label: full width
          '[&_[data-slot=field-row-label]]:w-full [&_[data-slot=field-row-label]]:shrink [&_[data-slot=field-row-label]]:pt-1.5 [&_[data-slot=field-row-label]]:pb-1 [&_[data-slot=field-row-content]]:ps-2',
          '[&_[data-slot=field-row]]:pb-1',
        ],
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  }
)

/**
 * Wrapper component for VarEditor field styling
 */
interface VarEditorFieldProps extends VariantProps<typeof varEditorFieldVariants> {
  children: React.ReactNode
  validationError?: string
  validationType?: 'error' | 'warning'
  className?: string
}

const VarEditorField: React.FC<VarEditorFieldProps> = ({
  children,
  validationError,
  validationType = 'error',
  orientation = 'horizontal',
  className,
}) => {
  return (
    <div
      data-slot="field"
      data-orientation={orientation}
      className={cn(varEditorFieldVariants({ orientation }), className)}>
      {children}
      <ValidationErrorBadge error={validationError} type={validationType} />
    </div>
  )
}

interface VarEditorFieldRowProps {
  children: React.ReactNode
  title: string
  description?: string
  isRequired?: boolean
  validationError?: string
  validationType?: 'error' | 'warning'
  type?: BaseType
  showIcon?: boolean
  icon?: React.ReactNode
  className?: string
}

const VarEditorFieldRow: React.FC<VarEditorFieldRowProps> = ({
  children,
  title,
  description,
  isRequired = false,
  validationError,
  validationType = 'error',
  type,
  icon,
  showIcon = false,
  className,
}) => {
  return (
    <div
      data-slot="field-row"
      className={cn('relative flex border-b dark:border-b-[#404754]/20', className)}>
      <div data-slot="field-row-label" className="flex flex-row gap-1 ps-2 items-center">
        {showIcon && (icon ? icon : <VarTypeIcon type={type!} />)}
        <div className="text-sm">
          <span className="text-primary-600">{title}</span>
          {isRequired && <span className="text-red-500">*</span>}
        </div>
        {description && <TooltipExplanation text={description} />}
      </div>
      <div data-slot="field-row-content" className="w-full flex-1">
        {children}
      </div>
      <ValidationErrorBadge error={validationError} type={validationType} />
    </div>
  )
}

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
    fieldOptions, // Full field.options for type-specific config (enum via fieldOptions.enum, fieldReference via fieldOptions.fieldReference)
    allowedTypes = [], // Type filtering
    mode = VAR_MODE.RICH,
    isConstantMode: controlledIsConstantMode,
    onConstantModeChange,
    defaultIsConstantMode = false,
    hideClearButton = false,
  }) => {
    const containerRef = useRef<HTMLDivElement>(null)

    // Determine if controlled
    const isControlled = controlledIsConstantMode !== undefined

    // Internal state for uncontrolled mode
    const [internalIsConstantMode, setInternalIsConstantMode] = useState(defaultIsConstantMode)

    // Use controlled value if provided, otherwise internal
    const isConstantMode = isControlled ? controlledIsConstantMode : internalIsConstantMode

    const [constantValue, setConstantValue] = useState(value || '')

    // Track previous constant values for each data type to allow restoration
    const [previousConstantValues, setPreviousConstantValues] = useState<Record<string, string>>({})

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
      initialContent: isConstantMode ? '' : value,
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
        let newConstantValue = ''

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
      setPreviousConstantValues,
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

    // Extract variable from content for picker mode display

    return (
      <div
        ref={containerRef}
        className={cn(
          'group/editor input-editor-wrapper relative flex items-start gap-0.5 flex-1 shrink-0 items-stretch',
          showReadOnlyOverlay && 'opacity-50 cursor-not-allowed',
          className
        )}
        data-focused={isFocused}
        data-readonly={readOnly}>
        {!readOnly && allowConstant && (
          <Tooltip content={isConstantMode ? 'Switch to variable mode' : 'Switch to constant'}>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 hover:bg-primary-200 mt-1"
              onClick={handleToggleMode}
              disabled={disabled || readOnly}>
              {isConstantMode ? (
                <span className="text-xs text-primary-500">C</span>
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
            className="flex-1"
          />
        ) : mode === VAR_MODE.PICKER ? (
          <VariablePicker
            nodeId={nodeId}
            onVariableSelect={handleVariableSelect}
            value={value}
            allowedTypes={finalAllowedTypes}
            popoverWidth={400}
            popoverHeight={500}>
            <div className="w-full h-8 flex items-center">
              {value ? (
                <VariableTag variableId={value} nodeId={nodeId} isShort />
              ) : (
                <span className="text-sm text-primary-400 truncate pointer-events-none">
                  {placeholder}
                </span>
              )}
            </div>
          </VariablePicker>
        ) : (
          <EditorContent
            editor={editor}
            className="input-editor-field flex-1 w-full pt-[6.5px] pb-[4px] focus:outline-none focus:ring-0 h-full [&>*:first-child]:focus:outline-none"
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
            className="max-h-[400px]"
            placeholder="Type in editor to filter..."
            onClose={closePicker}
          />
        </InlinePickerPopover>

        {!readOnly &&
          !hideClearButton &&
          (isConstantMode ? constantValue !== '' : stringContent !== '') && (
            <div className="pt-1 px-1 h-full">
              <Tooltip content={'Clear content'}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-4 bg-primary-500/30 text-primary-100 transition-color hover:bg-bad-100 hover:text-bad-500"
                  onClick={handleClearContent}>
                  <X className="size-3!" />
                </Button>
              </Tooltip>
            </div>
          )}

        {/* Read-only overlay to prevent interaction */}
        {showReadOnlyOverlay && <div className="absolute inset-0 z-10" />}
      </div>
    )
  }
)

export { VarEditor, VarEditorField, VarEditorFieldRow }
