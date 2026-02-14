// apps/web/src/lib/extensions/components/workflow/variables/input-editor.tsx

import InputEditorUI from '~/components/workflow/ui/input-editor/input-editor'
import type { TiptapJSON } from '~/components/workflow/ui/input-editor/types'

/** Props for InputEditor component */
interface InputEditorProps {
  /** Current editor value in Tiptap JSON format */
  value: TiptapJSON
  /** ID of the workflow node this editor belongs to */
  nodeId: string
  /** Placeholder text for empty editor */
  placeholder?: string
  /** Whether to allow multiple lines */
  multiline?: boolean
  /** Number of rows for multiline mode */
  rows?: number
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
  /** Internal instance identifier */
  __instanceId?: string
  /** Internal callback handler */
  __onCallHandler?: (instanceId: string, event: string, ...args: any[]) => Promise<void> | void
  /** Internal flag indicating if onChange handler exists */
  __hasOnChange?: boolean
  /** Internal flag indicating if onBlur handler exists */
  __hasOnBlur?: boolean
  /** Internal flag indicating if onFocus handler exists */
  __hasOnFocus?: boolean
}

/**
 * InputEditor component.
 * Rich text editor with variable insertion support for workflow forms.
 */
export const InputEditor = ({
  value,
  nodeId,
  placeholder,
  multiline = false,
  rows = 3,
  disabled = false,
  className,
  __instanceId,
  __onCallHandler,
  __hasOnChange,
  __hasOnBlur,
  __hasOnFocus,
}: InputEditorProps) => {
  const handleChange = async (value: TiptapJSON) => {
    if (__onCallHandler && __instanceId && __hasOnChange) {
      await __onCallHandler(__instanceId, 'onChange', value)
    }
  }

  const handleBlur = async (value: TiptapJSON) => {
    if (__onCallHandler && __instanceId && __hasOnBlur) {
      await __onCallHandler(__instanceId, 'onBlur', value)
    }
  }

  const handleFocus = async () => {
    if (__onCallHandler && __instanceId && __hasOnFocus) {
      await __onCallHandler(__instanceId, 'onFocus')
    }
  }

  return (
    <InputEditorUI
      value={value}
      nodeId={nodeId}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
    />
  )
}
