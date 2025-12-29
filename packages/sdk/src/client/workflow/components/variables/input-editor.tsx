// packages/sdk/src/client/workflow/components/variables/input-editor.tsx

import type React from 'react'

/**
 * Props for InputEditor component
 */
export interface InputEditorProps {
  /** Current value (can contain {{...}} variable references) */
  value: string

  /** Change callback */
  onChange?: (value: string) => void

  /** Blur callback */
  onBlur?: (value: string) => void

  /** Focus callback */
  onFocus?: () => void

  /** Current node ID (for variable context) */
  nodeId: string

  /** UI customization */
  placeholder?: string
  multiline?: boolean
  rows?: number
  disabled?: boolean
  className?: string

  /** Additional props */
  [key: string]: any
}

/**
 * Rich text editor supporting mixed plain text and variables.
 *
 * This component allows users to type plain text and insert variables inline.
 * Variables can be inserted using the '{' trigger.
 *
 * @example
 * ```typescript
 * import { InputEditor } from '@auxx/sdk/client'
 *
 * export function EmailPanel() {
 *   const { nodeId, data, updateData } = useWorkflowContext()
 *
 *   return (
 *     <WorkflowPanel>
 *       <Section>
 *         <Label>Email Subject</Label>
 *         <InputEditor
 *           value={data.subject || ''}
 *           onChange={(value) => updateData({ subject: value })}
 *           nodeId={nodeId}
 *           placeholder="Enter subject..."
 *         />
 *
 *         <Label>Email Body</Label>
 *         <InputEditor
 *           value={data.body || ''}
 *           onChange={(value) => updateData({ body: value })}
 *           nodeId={nodeId}
 *           placeholder="Enter message..."
 *           multiline={true}
 *           rows={6}
 *         />
 *       </Section>
 *     </WorkflowPanel>
 *   )
 * }
 * ```
 */
export const InputEditor: React.FC<InputEditorProps> = (props) => {
  const React = (window as any).React
  if (!React) {
    throw new Error('[auxx/client] React not available in window')
  }
  return React.createElement('auxxworkflowinputeditor', {
    ...props,
    component: 'InputEditorInternal',
  })
}
