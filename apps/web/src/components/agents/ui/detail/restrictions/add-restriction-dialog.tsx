// apps/web/src/components/agents/ui/detail/restrictions/add-restriction-dialog.tsx
'use client'

import type { ArgRestriction } from '@auxx/lib/agents/restrictions/client'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { ChevronLeft } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { ToolReferenceList } from '~/components/pickers/tool-picker/tool-reference-list'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { argToFieldType } from '~/lib/agents/restrictions/arg-to-field-type'
import type { AgentDetail } from '../../../store/agent-store'
import type { ToolMeta, UseToolMetaResult } from './hooks/use-tool-meta'
import { RestrictionRequiredBadge } from './restriction-required-badge'
import { RestrictionValueEditor } from './restriction-value-editor'
import { type ToolArgInfo, topLevelArgs } from './tool-args'

interface AddRestrictionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentDetail
  toolMeta: UseToolMetaResult
  /**
   * Pre-fill for edit mode — the tool's registered name. When set, the dialog
   * skips the tool step and opens directly on the all-args panel, seeded from
   * the tool's existing restrictions.
   */
  editing?: { registeredName: string } | null
  /** Commit the whole tool's arg→restriction map (full-replace for that tool). */
  onSave: (registeredName: string, byArg: Record<string, ArgRestriction>) => void
}

type Step = 'tool' | 'args'

/** Default restriction for an arg the admin hasn't touched. */
const MODEL_DECIDES: ArgRestriction = { source: 'model', required: false }

/**
 * Render the platform-`FieldType` icon for a tool-arg restriction row — the
 * same `fieldTypeOptions` icon map the field picker uses. Falls back to a
 * neutral `circle` for unknown/structured args. See plans/chat/v6 phase-4
 * redesign.
 */
function fieldTypeIcon(fieldType?: string): ReactNode {
  const iconId =
    (fieldType && fieldTypeOptions[fieldType as keyof typeof fieldTypeOptions]?.iconId) || 'circle'
  return <EntityIcon iconId={iconId} size='xs' className='text-muted-foreground' />
}

/**
 * Seed a tool's draft from its persisted restrictions, ensuring identity args
 * carry a default binding (suggested var, required) so chat never fail-closes.
 */
function seedDraft(tool: ToolMeta, persisted: Record<string, ArgRestriction>) {
  const draft: Record<string, ArgRestriction> = { ...persisted }
  for (const id of tool.identityScopedInputs ?? []) {
    if (!draft[id.name]) {
      draft[id.name] = id.suggestedVar
        ? { source: 'var', var: id.suggestedVar, required: true }
        : { source: 'var', required: true }
    }
  }
  return draft
}

/** True when a restriction is bound but missing its value/var (can't save). */
function isIncomplete(r: ArgRestriction): boolean {
  if (r.source === 'var') return !r.var
  if (r.source === 'constant') return r.value === undefined || r.value === null || r.value === ''
  return false
}

/**
 * Add/edit a tool's argument restrictions. Two steps:
 *   1. Tool select — reuses `ToolReferenceList`, scoped to enabled tools.
 *   2. All-args panel — every top-level arg as a `VarEditorField` row with an
 *      inline constant⇄dynamic value editor + a Required pill. Empty rows mean
 *      "model decides" and are pruned on save.
 *
 * Identity-scoped args are pre-seeded to their suggested var and locked
 * required. See plans/chat/v6 phase-4 redesign.
 */
export function AddRestrictionDialog({
  open,
  onOpenChange,
  agent,
  toolMeta,
  editing,
  onSave,
}: AddRestrictionDialogProps) {
  const [step, setStep] = useState<Step>('tool')
  const [registeredName, setRegisteredName] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, ArgRestriction>>({})

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

  // Initialize on open / edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens or the edit target changes.
  useEffect(() => {
    if (!open) return
    if (editing) {
      setRegisteredName(editing.registeredName)
      const tool = toolMeta.byRegisteredName.get(editing.registeredName)
      const persisted = agent.toolRestrictions?.[editing.registeredName] ?? {}
      setDraft(tool ? seedDraft(tool, persisted) : { ...persisted })
      setStep('args')
    } else {
      setRegisteredName(null)
      setDraft({})
      setStep('tool')
    }
  }, [open, editing])

  const handleSelectTool = (chipId: string) => {
    // ToolReferenceList emits `tool:<catalogName>`; map to the registered name.
    const catalogName = chipId.replace(/^tool:/, '')
    const resolved = toolMeta.registeredNameByCatalogName.get(catalogName)
    if (!resolved) return
    const tool = toolMeta.byRegisteredName.get(resolved)
    const persisted = agent.toolRestrictions?.[resolved] ?? {}
    setRegisteredName(resolved)
    setDraft(tool ? seedDraft(tool, persisted) : { ...persisted })
    setStep('args')
  }

  const setRow = (arg: string, next: ArgRestriction) => setDraft((d) => ({ ...d, [arg]: next }))

  const canSave = !!registeredName && !Object.values(draft).some((r) => isIncomplete(r))

  const handleSave = () => {
    if (!registeredName) return
    const byArg: Record<string, ArgRestriction> = {}
    for (const [arg, r] of Object.entries(draft)) {
      // Prune pure model-decides — only persist real restrictions.
      if (r.source === 'model' && !r.required) continue
      byArg[arg] = r
    }
    onSave(registeredName, byArg)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {step === 'args' && !editing ? (
              <button
                type='button'
                aria-label='Back'
                className='rounded-md p-0.5 hover:bg-primary/5'
                onClick={() => setStep('tool')}>
                <ChevronLeft className='size-4 text-muted-foreground' />
              </button>
            ) : null}
            {step === 'tool' ? 'Add restriction' : (selectedTool?.displayName ?? 'Restrictions')}
          </DialogTitle>
          <DialogDescription>
            {step === 'tool'
              ? 'Pick a tool, then bind its arguments.'
              : 'Pin each argument to a value, or leave it for the model to decide.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'tool' ? (
          <ToolReferenceList
            filterNames={toolMeta.enabledCatalogNames}
            onSelectSingle={handleSelectTool}
            className='border'
          />
        ) : null}

        {step === 'args' ? (
          <ScrollArea className='max-h-[28rem]'>
            <div className='pe-2'>
              {args.length === 0 ? (
                <p className='px-2 py-4 text-sm text-muted-foreground'>
                  This tool has no top-level arguments.
                </p>
              ) : (
                <VarEditorField className='p-0'>
                  {args.map((arg) => {
                    const mapped = argToFieldType(arg.schema)
                    const isIdentity = identityArgNames.has(arg.name)
                    const r = draft[arg.name] ?? MODEL_DECIDES
                    const suggested = selectedTool?.identityScopedInputs.find(
                      (i) => i.name === arg.name
                    )?.suggestedVar

                    return (
                      <VarEditorFieldRow
                        key={arg.name}
                        title={arg.name}
                        description={arg.schema.description}
                        icon={fieldTypeIcon(mapped.supported ? mapped.fieldType : undefined)}
                        showIcon
                        isRequired={r.required}
                        onClear={
                          !isIdentity && r.source !== 'model'
                            ? () => setRow(arg.name, { source: 'model', required: r.required })
                            : undefined
                        }>
                        {mapped.supported ? (
                          <div className='relative'>
                            <div className='absolute right-full top-1/2 z-10 -translate-y-1/2 me-0.5'>
                              <RestrictionRequiredBadge
                                required={!!r.required}
                                isIdentityArg={isIdentity}
                                onChange={(req) => setRow(arg.name, { ...r, required: req })}
                              />
                            </div>
                            <RestrictionValueEditor
                              restriction={r}
                              onChange={(next) => setRow(arg.name, next)}
                              argFieldType={mapped.fieldType}
                              fieldOptions={mapped.options}
                              agentId={agent.id}
                              agentKind={agent.kind}
                              isIdentityArg={isIdentity}
                              suggestedVar={suggested}
                            />
                          </div>
                        ) : (
                          <p className='py-2 text-xs italic text-muted-foreground'>
                            {mapped.reason}
                          </p>
                        )}
                      </VarEditorFieldRow>
                    )
                  })}
                </VarEditorField>
              )}
            </div>
          </ScrollArea>
        ) : null}

        {step === 'args' ? (
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
