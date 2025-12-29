// apps/web/src/components/custom-fields/ui/text-options-editor.tsx

'use client'

import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { ConstantInputAdapter } from '~/components/workflow/ui/input-editor/constant-input-adapter'
import { BaseType } from '~/components/workflow/types/unified-types'

/**
 * String options for text field configuration
 */
export interface TextOptions {
  multiline?: boolean
  minLength?: number
  maxLength?: number
}

/**
 * Props for TextOptionsEditor component
 */
interface TextOptionsEditorProps {
  options: TextOptions
  onChange: (options: TextOptions) => void
  disabled?: boolean
}

/**
 * TextOptionsEditor component
 * Configures string field options: multiline, min/max length
 * Uses VarEditorField/VarEditorFieldRow pattern for consistency with panel design
 */
export function TextOptionsEditor({ options, onChange, disabled }: TextOptionsEditorProps) {
  /**
   * Handle individual option changes
   */
  const handleChange = (key: keyof TextOptions) => (_content: string, value: any) => {
    onChange({ ...options, [key]: value })
  }

  return (
    <VarEditorField orientation="horizontal" className="p-0">
      {/* Multiline Toggle */}
      <VarEditorFieldRow
        title="Multiline"
        description="Allow multiple lines of text (textarea)"
        type={BaseType.BOOLEAN}>
        <ConstantInputAdapter
          value={options.multiline ?? false}
          onChange={handleChange('multiline')}
          fieldOptions={{ variant: 'switch' }}
          varType={BaseType.BOOLEAN}
          disabled={disabled}
        />
      </VarEditorFieldRow>

      {/* Min Length */}
      <VarEditorFieldRow
        title="Min Length"
        description="Minimum number of characters required"
        type={BaseType.NUMBER}>
        <ConstantInputAdapter
          value={options.minLength ?? ''}
          onChange={handleChange('minLength')}
          varType={BaseType.NUMBER}
          placeholder="No minimum"
          disabled={disabled}
        />
      </VarEditorFieldRow>

      {/* Max Length */}
      <VarEditorFieldRow
        title="Max Length"
        description="Maximum number of characters allowed"
        type={BaseType.NUMBER}>
        <ConstantInputAdapter
          value={options.maxLength ?? ''}
          onChange={handleChange('maxLength')}
          varType={BaseType.NUMBER}
          placeholder="No maximum"
          disabled={disabled}
        />
      </VarEditorFieldRow>
    </VarEditorField>
  )
}
