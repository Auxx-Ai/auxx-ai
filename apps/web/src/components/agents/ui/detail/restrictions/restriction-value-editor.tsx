// apps/web/src/components/agents/ui/detail/restrictions/restriction-value-editor.tsx
'use client'

import type { VarSource } from '@auxx/lib/agents/bindings/client'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { ChevronsLeftRightEllipsis } from 'lucide-react'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { RestrictionVarPicker } from './restriction-var-picker'

interface RestrictionValueEditorProps {
  /** The input's working binding (`VarSource`). */
  source: VarSource
  onChange: (next: VarSource) => void
  /** The input's mapped platform `FieldType` (constant input + var type filter). */
  argFieldType?: string
  /** `FieldOptions` for the constant adapter (enum options for selects, etc.). */
  fieldOptions?: FieldOptions
  disabled?: boolean
}

type Mode = 'constant' | 'var'

/**
 * The inline value control for one tool input, placed inside a
 * `VarEditorFieldRow`. A left mode-toggle (constant ⇄ dynamic field) plus the
 * active input. The empty state means **"model decides"** (`{ kind:'model' }`)
 * — the row's hover `X` returns a bound input to it. See plans/chat/v8 phase-5.
 */
export function RestrictionValueEditor({
  source,
  onChange,
  argFieldType,
  fieldOptions,
  disabled,
}: RestrictionValueEditorProps) {
  const [mode, setMode] = useState<Mode>(source.kind === 'var' ? 'var' : 'constant')
  const isConstant = mode === 'constant'

  const toggleMode = () => {
    const next: Mode = isConstant ? 'var' : 'constant'
    setMode(next)
    // Toggling drops the now-inactive source's value → model-decides until new
    // content is entered.
    onChange({ kind: 'model' })
  }

  const handleConstantChange = (value: unknown) => {
    if (value === undefined || value === null || value === '') onChange({ kind: 'model' })
    else onChange({ kind: 'const', value })
  }

  const refValue = source.kind === 'var' && typeof source.ref === 'string' ? source.ref : undefined

  return (
    <div className='flex min-h-8 w-full items-stretch gap-0.5'>
      <Tooltip content={isConstant ? 'Switch to dynamic value' : 'Switch to constant'}>
        <Button
          variant='ghost'
          size='icon-xs'
          className='mt-1 shrink-0 hover:bg-primary-200'
          onClick={toggleMode}
          disabled={disabled}>
          {isConstant ? (
            <span className='text-xs text-primary-500'>C</span>
          ) : (
            <ChevronsLeftRightEllipsis />
          )}
        </Button>
      </Tooltip>

      <div className='flex-1'>
        {isConstant ? (
          <FieldInputAdapter
            fieldType={argFieldType ?? 'TEXT'}
            fieldOptions={fieldOptions}
            value={source.kind === 'const' ? source.value : undefined}
            onChange={handleConstantChange}
            placeholder={source.kind === 'model' ? 'Model decides' : 'Enter value'}
            disabled={disabled}
          />
        ) : (
          <RestrictionVarPicker
            value={refValue}
            onChange={(ref) => onChange({ kind: 'var', ref })}
            argFieldType={argFieldType}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  )
}
