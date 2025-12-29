// components/editor/EditorSelector.tsx
import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { useEditorActiveStateContext } from '~/components/mail/email-editor/editor-active-state-context'

type EditorSelectorProps = {
  id: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  placeholderIcon?: React.ReactNode
  className?: string
  disabled?: boolean
}

const EditorSelector = ({
  id,
  options,
  value,
  onChange,
  placeholder = 'Select...',
  placeholderIcon,
  className = '',
  disabled = false,
}: EditorSelectorProps) => {
  // Try to get active state context if available
  let activeState: any = null
  try {
    activeState = useEditorActiveStateContext()
  } catch {
    // Context not available, component used outside email editor
  }

  return (
    <Select
      value={value}
      onValueChange={onChange}
      onOpenChange={(open) => {
        if (activeState) {
          if (open) {
            activeState.trackSelectOpen(id)
          } else {
            activeState.trackSelectClose(id)
          }
        }
      }}>
      <SelectTrigger variant="outline" className={` ${className}`} size="sm" disabled={disabled}>
        <SelectValue
          placeholder={
            placeholderIcon ? (
              <span className="flex items-center gap-1.5">
                {placeholderIcon}
                <span>{placeholder}</span>
              </span>
            ) : (
              placeholder
            )
          }
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default EditorSelector
