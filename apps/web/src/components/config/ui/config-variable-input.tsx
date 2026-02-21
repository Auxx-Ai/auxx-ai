// apps/web/src/components/config/ui/config-variable-input.tsx
'use client'

import type { ConfigVariableDefinition } from '@auxx/credentials/config/client'
import { InputGroupInput } from '@auxx/ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'

interface ConfigVariableInputProps {
  definition: ConfigVariableDefinition
  value: unknown
  onChange: (value: string | number | boolean | string[]) => void
}

/**
 * Renders the correct input type based on the variable definition.
 * STRING/NUMBER/default types render InputGroupInput for use inside InputGroup.
 * BOOLEAN/ENUM/ARRAY render standalone controls.
 */
export function ConfigVariableInput({ definition, value, onChange }: ConfigVariableInputProps) {
  switch (definition.type) {
    case 'STRING':
      return (
        <InputGroupInput
          type={definition.isSensitive ? 'password' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={definition.defaultValue ? String(definition.defaultValue) : undefined}
          className='font-mono text-xs'
        />
      )

    case 'NUMBER':
      return (
        <InputGroupInput
          type='number'
          value={value !== null ? String(value) : ''}
          onChange={(e) => onChange(Number(e.target.value))}
          min={definition.min}
          max={definition.max}
          placeholder={definition.defaultValue ? String(definition.defaultValue) : undefined}
          className='font-mono text-xs'
        />
      )

    case 'BOOLEAN':
      return (
        <div className='flex items-center gap-2 px-3 flex-1'>
          <Switch
            checked={value === true || value === 'true'}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <span className='text-sm text-muted-foreground'>
            {value === true || value === 'true' ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      )

    case 'ENUM':
      return (
        <div className='flex-1 px-1'>
          <Select value={String(value ?? '')} onValueChange={onChange}>
            <SelectTrigger className='border-0 shadow-none'>
              <SelectValue placeholder='Select...' />
            </SelectTrigger>
            <SelectContent>
              {definition.options?.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )

    case 'ARRAY':
      return (
        <Textarea
          value={Array.isArray(value) ? JSON.stringify(value, null, 2) : String(value ?? '')}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              // Keep raw string while user is typing
            }
          }}
          placeholder='["value1", "value2"]'
          rows={4}
        />
      )

    default:
      return (
        <InputGroupInput
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className='font-mono text-xs'
        />
      )
  }
}
