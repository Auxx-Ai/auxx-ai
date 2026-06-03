// apps/web/src/components/agents/ui/detail/restrictions/restriction-value-editor.tsx
'use client'

import type { ArgRestriction } from '@auxx/lib/agents/restrictions/client'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { ChevronsLeftRightEllipsis } from 'lucide-react'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { Tooltip } from '~/components/global/tooltip'
import { RestrictionVarPicker } from './restriction-var-picker'

interface RestrictionValueEditorProps {
  /** The arg's working restriction (`{ source, required, var?, value? }`). */
  restriction: ArgRestriction
  onChange: (next: ArgRestriction) => void
  /** The arg's mapped platform `FieldType` (constant input + var type filter). */
  argFieldType?: string
  /** `FieldOptions` for the constant adapter (enum options for selects, etc.). */
  fieldOptions?: FieldOptions
  agentId: string
  agentKind: 'internal' | 'chat'
  /** Identity args force a binding — model-decides (empty) is forbidden. */
  isIdentityArg: boolean
  /** Identity-arg default var to re-seed when toggling back to dynamic mode. */
  suggestedVar?: string
  disabled?: boolean
}

type Mode = 'constant' | 'var'

/**
 * The inline value control for one tool arg, placed inside a
 * `VarEditorFieldRow`. Visual analogue of the workflow `VarEditor`: a left
 * mode-toggle (constant ⇄ dynamic registry var) plus the active input. The
 * empty state means **"model decides"** — the row's hover `X` (provided by
 * `VarEditorFieldRow.onClear`) returns a bound arg to it. Identity args can
 * never land on model. See plans/chat/v6 phase-4 redesign.
 */
export function RestrictionValueEditor({
  restriction,
  onChange,
  argFieldType,
  fieldOptions,
  agentId,
  agentKind,
  isIdentityArg,
  suggestedVar,
  disabled,
}: RestrictionValueEditorProps) {
  const [mode, setMode] = useState<Mode>(restriction.source === 'var' ? 'var' : 'constant')
  const required = restriction.required

  const isConstant = mode === 'constant'

  const toggleMode = () => {
    const next: Mode = isConstant ? 'var' : 'constant'
    setMode(next)
    // Toggling drops the now-inactive source's value. Non-identity args return
    // to model-decides until new content; identity args stay bound to the new
    // mode (re-seeding the suggested var) since model is forbidden.
    if (next === 'var') {
      onChange(
        isIdentityArg
          ? { source: 'var', var: suggestedVar, required }
          : { source: 'model', required }
      )
    } else {
      onChange(isIdentityArg ? { source: 'constant', required } : { source: 'model', required })
    }
  }

  const handleConstantChange = (value: unknown) => {
    if (value === undefined || value === null || value === '') {
      // Empty constant ⇒ model-decides, unless identity (kept incomplete so the
      // dialog blocks save until a value is entered).
      onChange(isIdentityArg ? { source: 'constant', required } : { source: 'model', required })
    } else {
      onChange({ source: 'constant', value, required })
    }
  }

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
            value={restriction.source === 'constant' ? restriction.value : undefined}
            onChange={handleConstantChange}
            placeholder={restriction.source === 'model' ? 'Model decides' : 'Enter value'}
            disabled={disabled}
          />
        ) : (
          <RestrictionVarPicker
            value={restriction.source === 'var' ? restriction.var : undefined}
            onChange={(varId) => onChange({ source: 'var', var: varId, required })}
            agentId={agentId}
            agentKind={agentKind}
            argFieldType={argFieldType}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  )
}
