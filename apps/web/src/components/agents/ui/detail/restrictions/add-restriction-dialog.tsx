// apps/web/src/components/agents/ui/detail/restrictions/add-restriction-dialog.tsx
'use client'

import type { ArgRestriction, RestrictionSource } from '@auxx/lib/agents/restrictions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Label } from '@auxx/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@auxx/ui/components/radio-group'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Switch } from '@auxx/ui/components/switch'
import { ChevronLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { ToolReferenceList } from '~/components/pickers/tool-picker/tool-reference-list'
import { argToFieldType } from '~/lib/agents/restrictions/arg-to-field-type'
import type { AgentDetail } from '../../../store/agent-store'
import type { ToolMeta, UseToolMetaResult } from './hooks/use-tool-meta'
import { RestrictionVarPicker } from './restriction-var-picker'
import { type ToolArgInfo, topLevelArgs } from './tool-args'

interface AddRestrictionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentDetail
  toolMeta: UseToolMetaResult
  /**
   * Pre-fill for edit mode — the tool's registered name + arg name. When set,
   * the dialog skips the tool/arg steps and opens directly on the per-arg
   * control with the existing restriction loaded.
   */
  editing?: { registeredName: string; arg: string } | null
  /** Current restriction for the editing target (so the control pre-fills). */
  editingRestriction?: ArgRestriction
  /** Commit one arg's restriction. The parent merges it into the full map. */
  onSave: (registeredName: string, arg: string, restriction: ArgRestriction) => void
}

type Step = 'tool' | 'arg' | 'control'

/**
 * Add/edit one tool-argument restriction. Three steps:
 *   1. Tool select — reuses `ToolReferenceList`, scoped to enabled tools.
 *   2. Argument list — top-level scalar props of the tool's JSON Schema.
 *   3. Per-arg control — Source (Model / Dynamic var / Constant) + Required.
 *
 * Identity-scoped args default to their suggested visitor var. See
 * plans/chat/v6 phase-4.
 */
export function AddRestrictionDialog({
  open,
  onOpenChange,
  agent,
  toolMeta,
  editing,
  editingRestriction,
  onSave,
}: AddRestrictionDialogProps) {
  const [step, setStep] = useState<Step>('tool')
  const [registeredName, setRegisteredName] = useState<string | null>(null)
  const [argName, setArgName] = useState<string | null>(null)

  // Per-arg control state.
  const [source, setSource] = useState<RestrictionSource>('model')
  const [varId, setVarId] = useState<string | undefined>(undefined)
  const [constantValue, setConstantValue] = useState<unknown>(undefined)
  const [required, setRequired] = useState(false)

  const selectedTool: ToolMeta | undefined = registeredName
    ? toolMeta.byRegisteredName.get(registeredName)
    : undefined

  const args = useMemo<ToolArgInfo[]>(
    () => (selectedTool ? topLevelArgs(selectedTool.inputsJsonSchema) : []),
    [selectedTool]
  )

  const identityArgNames = useMemo(
    () => new Set((selectedTool?.identityScopedInputs ?? []).map((i) => i.name)),
    [selectedTool]
  )

  // Identity-scoped args must resolve to a platform value (var/constant); the
  // runtime author-floor refuses a `model` binding for them. Hide that option so
  // an admin can't author a binding the engine will fail closed on. See
  // plans/chat/v6 phase-3 + apply.ts.
  const isIdentityArg = argName ? identityArgNames.has(argName) : false

  const selectedArg = useMemo(() => args.find((a) => a.name === argName), [args, argName])
  const argFieldTypeResult = selectedArg ? argToFieldType(selectedArg.schema) : undefined

  // Initialize on open / edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens or the edit target changes.
  useEffect(() => {
    if (!open) return
    if (editing) {
      setRegisteredName(editing.registeredName)
      setArgName(editing.arg)
      setStep('control')
      const r = editingRestriction
      setSource(r?.source ?? 'model')
      setVarId(r?.var)
      setConstantValue(r?.value)
      setRequired(r?.required ?? false)
    } else {
      setRegisteredName(null)
      setArgName(null)
      setStep('tool')
      setSource('model')
      setVarId(undefined)
      setConstantValue(undefined)
      setRequired(false)
    }
  }, [open, editing])

  const handleSelectTool = (chipId: string) => {
    // ToolReferenceList emits `tool:<catalogName>`; map to the registered name.
    const catalogName = chipId.replace(/^tool:/, '')
    const resolved = toolMeta.registeredNameByCatalogName.get(catalogName)
    if (!resolved) return
    setRegisteredName(resolved)
    setStep('arg')
  }

  const handleSelectArg = (arg: ToolArgInfo) => {
    setArgName(arg.name)
    // Identity-scoped arg with a suggested var → default to that var binding.
    const suggested = selectedTool?.identityScopedInputs?.find((i) => i.name === arg.name)
    if (suggested?.suggestedVar) {
      setSource('var')
      setVarId(suggested.suggestedVar)
      setRequired(true)
    } else {
      setSource('model')
      setVarId(undefined)
      setConstantValue(undefined)
      setRequired(false)
    }
    setStep('control')
  }

  const handleSave = () => {
    if (!registeredName || !argName) return
    const restriction: ArgRestriction = { source, required }
    if (source === 'var') restriction.var = varId
    if (source === 'constant') restriction.value = constantValue
    onSave(registeredName, argName, restriction)
    onOpenChange(false)
  }

  const canSave =
    !!registeredName &&
    !!argName &&
    // Identity args can't be left to the model — the runtime floor refuses it.
    !(isIdentityArg && source === 'model') &&
    (source !== 'var' || !!varId) &&
    (source !== 'constant' || constantValue !== undefined)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {step !== 'tool' && !editing ? (
              <button
                type='button'
                aria-label='Back'
                className='rounded-md p-0.5 hover:bg-primary/5'
                onClick={() => setStep(step === 'control' ? 'arg' : 'tool')}>
                <ChevronLeft className='size-4 text-muted-foreground' />
              </button>
            ) : null}
            {step === 'tool'
              ? 'Add restriction'
              : step === 'arg'
                ? (selectedTool?.displayName ?? 'Choose an argument')
                : `${selectedTool?.displayName ?? ''} · ${argName ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {step === 'tool'
              ? 'Pick a tool, then lock one of its arguments.'
              : step === 'arg'
                ? 'Choose the argument to restrict. Only scalar arguments can be bound.'
                : 'Bind this argument to a value, or just mark it required.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'tool' ? (
          <ToolReferenceList
            filterNames={toolMeta.enabledCatalogNames}
            onSelectSingle={handleSelectTool}
            className='border'
          />
        ) : null}

        {step === 'arg' ? (
          <ScrollArea className='max-h-80'>
            <div className='flex flex-col gap-1 pe-2'>
              {args.length === 0 ? (
                <p className='px-2 py-4 text-sm text-muted-foreground'>
                  This tool has no top-level arguments.
                </p>
              ) : (
                args.map((arg) => {
                  const mapped = argToFieldType(arg.schema)
                  const disabled = !mapped.supported
                  const isIdentity = identityArgNames.has(arg.name)
                  return (
                    <button
                      key={arg.name}
                      type='button'
                      disabled={disabled}
                      onClick={() => handleSelectArg(arg)}
                      className='flex flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent'>
                      <span className='flex items-center gap-2'>
                        <span className='text-sm font-medium'>{arg.name}</span>
                        <span className='text-xs text-muted-foreground'>{arg.typeLabel}</span>
                        {isIdentity ? (
                          <Badge variant='amber' size='sm'>
                            needs binding
                          </Badge>
                        ) : null}
                      </span>
                      {arg.schema.description ? (
                        <span className='text-xs text-muted-foreground'>
                          {arg.schema.description}
                        </span>
                      ) : null}
                      {disabled && !mapped.supported ? (
                        <span className='text-xs text-muted-foreground italic'>
                          {mapped.reason}
                        </span>
                      ) : null}
                    </button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        ) : null}

        {step === 'control' ? (
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label>Value source</Label>
              <RadioGroup
                value={source}
                onValueChange={(v) => setSource(v as RestrictionSource)}
                className='flex flex-col gap-2'>
                {isIdentityArg ? null : (
                  <label className='flex items-center gap-2 text-sm'>
                    <RadioGroupItem value='model' />
                    Model decides (default)
                  </label>
                )}
                <label className='flex items-center gap-2 text-sm'>
                  <RadioGroupItem value='var' />
                  Dynamic value
                </label>
                <label className='flex items-center gap-2 text-sm'>
                  <RadioGroupItem value='constant' />
                  Constant
                </label>
              </RadioGroup>
            </div>

            {source === 'var' ? (
              <RestrictionVarPicker
                value={varId}
                onChange={setVarId}
                agentId={agent.id}
                agentKind={agent.kind}
                argFieldType={
                  argFieldTypeResult?.supported ? argFieldTypeResult.fieldType : undefined
                }
              />
            ) : null}

            {source === 'constant' && argFieldTypeResult?.supported ? (
              <FieldInputAdapter
                fieldType={argFieldTypeResult.fieldType}
                fieldOptions={argFieldTypeResult.options}
                value={constantValue}
                onChange={setConstantValue}
                placeholder='Enter a value…'
              />
            ) : null}

            <label className='flex items-center justify-between rounded-md border px-3 py-2'>
              <span className='flex flex-col'>
                <span className='text-sm font-medium'>Required</span>
                <span className='text-xs text-muted-foreground'>
                  Refuse the call when this value can't be resolved.
                </span>
              </span>
              <Switch checked={required} onCheckedChange={setRequired} />
            </label>
          </div>
        ) : null}

        {step === 'control' ? (
          <DialogFooter>
            <Button variant='ghost' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              {editing ? 'Save' : 'Add restriction'}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
