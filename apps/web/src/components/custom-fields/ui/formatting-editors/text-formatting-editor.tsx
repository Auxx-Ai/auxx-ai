// apps/web/src/components/custom-fields/ui/formatting-editors/text-formatting-editor.tsx
'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { ToggleCard } from '@auxx/ui/components/toggle-card'

/** Props for TextFormattingEditor */
interface TextFormattingEditorProps {
  options: Pick<FieldOptions, 'multiline'>
  onChange: (options: { multiline: boolean }) => void
}

/**
 * Editor for TEXT field display options.
 * Multiline swaps the single-line input for an auto-sizing textarea, and lets the
 * displayed value wrap onto several lines (capped, with an internal scroll)
 * instead of being clipped to one.
 */
export function TextFormattingEditor({ options, onChange }: TextFormattingEditorProps) {
  return (
    <ToggleCard
      title='Multiline'
      description='Wrap long values over multiple lines'
      checked={options.multiline ?? false}
      onCheckedChange={(multiline) => onChange({ multiline })}
    />
  )
}
