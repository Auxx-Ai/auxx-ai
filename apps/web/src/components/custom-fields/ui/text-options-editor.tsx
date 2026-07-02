// apps/web/src/components/custom-fields/ui/text-options-editor.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
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
 * Uses FieldPanel/FieldPanelRow pattern for consistency with panel design
 */
export function TextOptionsEditor({ options, onChange, disabled }: TextOptionsEditorProps) {
  /**
   * Handle individual option changes
   */
  const handleChange = (key: keyof TextOptions) => (value: unknown) => {
    onChange({ ...options, [key]: value })
  }

  return (
    <FieldPanel orientation='horizontal' className='p-0'>
      {/* Multiline Toggle */}
      <FieldPanelRow
        title='Multiline'
        description='Allow multiple lines of text (textarea)'
        type={BaseType.BOOLEAN}>
        <FieldInputAdapter
          fieldType={FieldType.CHECKBOX}
          value={options.multiline ?? false}
          onChange={handleChange('multiline')}
          fieldOptions={{ variant: 'switch' }}
          disabled={disabled}
        />
      </FieldPanelRow>

      {/* Min Length */}
      <FieldPanelRow
        title='Min Length'
        description='Minimum number of characters required'
        type={BaseType.NUMBER}>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={options.minLength ?? ''}
          onChange={handleChange('minLength')}
          placeholder='No minimum'
          disabled={disabled}
        />
      </FieldPanelRow>

      {/* Max Length */}
      <FieldPanelRow
        title='Max Length'
        description='Maximum number of characters allowed'
        type={BaseType.NUMBER}>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={options.maxLength ?? ''}
          onChange={handleChange('maxLength')}
          placeholder='No maximum'
          disabled={disabled}
        />
      </FieldPanelRow>
    </FieldPanel>
  )
}
