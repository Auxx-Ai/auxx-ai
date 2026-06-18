// apps/web/src/components/workflow/nodes/core/http/components/workflow-field-adapters.tsx

'use client'

import type { HttpFieldEditor, HttpFilePicker } from '~/components/global/http-request'
import { BaseType } from '~/components/workflow/types/variable-types'
import { InputEditor } from '~/components/workflow/ui/input-editor'
import { Editor } from '~/components/workflow/ui/prompt-editor'
import { VariablePicker } from '~/components/workflow/ui/variables/variable-picker'

/**
 * Workflow adapters for the shared HTTP request builder's field-editor seam.
 *
 * These are the only pieces that still touch the workflow variable system /
 * ReactFlow. They bind the panel's `nodeId` and feed it through the
 * `HttpRequestFieldProvider`, so the shared components stay agnostic.
 *
 * `createWorkflowHttpFieldComponents(nodeId)` returns a `{ FieldEditor, FilePicker }`
 * pair preconfigured for that node. Behavior-preserving: single-line fields use
 * `InputEditor` (TipTap), multiline body fields use the prompt `Editor`, and the
 * file picker uses `VariablePicker` — exactly as before.
 */
export function createWorkflowHttpFieldComponents(nodeId: string): {
  FieldEditor: HttpFieldEditor
  FilePicker: HttpFilePicker
} {
  const FieldEditor: HttpFieldEditor = ({
    value,
    onChange,
    onBlur,
    placeholder,
    disabled,
    multiline,
    className,
  }) => {
    if (multiline) {
      return (
        <Editor
          nodeId={nodeId}
          value={value}
          onChange={(next) => onChange(next)}
          placeholder={placeholder}
          minHeight={100}
          readOnly={disabled}
        />
      )
    }

    return (
      <InputEditor
        nodeId={nodeId}
        value={value}
        onChange={(next) => onChange(next as unknown as string)}
        onBlur={onBlur ? () => onBlur() : undefined}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
      />
    )
  }

  const FilePicker: HttpFilePicker = ({ value, onSelect, placeholder }) => (
    <VariablePicker
      nodeId={nodeId}
      value={typeof value === 'string' ? value : value?.[1] || ''}
      onVariableSelect={(variable) => onSelect(['sys', variable.id])}
      allowedTypes={[BaseType.FILE, BaseType.ARRAY]}
      placeholder={placeholder}
    />
  )

  return { FieldEditor, FilePicker }
}
