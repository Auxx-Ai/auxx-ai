// apps/web/src/components/agents/ui/detail/bindings/add-binding-dialog.tsx
'use client'

import type { VarSource } from '@auxx/lib/agents/bindings/client'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ToolReferenceList } from '~/components/pickers/tool-picker/tool-reference-list'
import { argToFieldType } from '~/lib/agents/bindings/arg-to-field-type'
import type { AgentDetail } from '../../../store/agent-store'
import { BindingValueEditor } from './binding-value-editor'
import type { ToolMeta, UseToolMetaResult } from './hooks/use-tool-meta'
import { type ToolArgInfo, topLevelArgs } from './tool-args'

interface AddBindingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentDetail
  toolMeta: UseToolMetaResult
  /**
   * Pre-fill for edit mode — the tool's registered name. When set, the dialog
   * skips the tool step and opens directly on the all-inputs panel, seeded from
   * the tool's existing overrides.
   */
  editing?: { registeredName: string } | null
  /** Commit the whole tool's input→VarSource override map (full-replace). */
  onSave: (registeredName: string, byArg: Record<string, VarSource>) => void
}

type Step = 'tool' | 'args'

/** Default for an input the admin hasn't overridden — model decides (no override). */
const MODEL_DECIDES: VarSource = { kind: 'model' }

/**
 * Render the platform-`FieldType` icon for a tool-input row — the same
 * `fieldTypeOptions` icon map the field picker uses. Falls back to a neutral
 * `circle` for unknown/structured inputs.
 */
function fieldTypeIcon(fieldType?: string): ReactNode {
  const iconId =
    (fieldType && fieldTypeOptions[fieldType as keyof typeof fieldTypeOptions]?.iconId) || 'circle'
  return <EntityIcon iconId={iconId} size='xs' className='text-muted-foreground' />
}

/** True when a binding is set but missing its value/ref (can't save). */
function isIncomplete(source: VarSource): boolean {
  if (source.kind === 'var') {
    return Array.isArray(source.ref) ? source.ref.length === 0 : !source.ref
  }
  if (source.kind === 'const') {
    return source.value === undefined || source.value === null || source.value === ''
  }
  return false
}

/**
 * Add/edit a tool's input **overrides**. Two steps:
 *   1. Tool select — reuses `ToolReferenceList`, scoped to enabled tools.
 *   2. All-inputs panel — every top-level input as a `FieldPanelRow` with
 *      an inline constant⇄dynamic value editor. Empty rows mean "model decides"
 *      (no override) and are pruned on save, leaving the tool on its author
 *      defaults. See plans/chat/v8 phase-5.
 */
export function AddBindingDialog({
  open,
  onOpenChange,
  agent,
  toolMeta,
  editing,
  onSave,
}: AddBindingDialogProps) {
  const [step, setStep] = useState<Step>('tool')
  const [registeredName, setRegisteredName] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, VarSource>>({})

  const selectedTool: ToolMeta | undefined = registeredName
    ? toolMeta.byRegisteredName.get(registeredName)
    : undefined

  const args = useMemo<ToolArgInfo[]>(
    () => (selectedTool ? topLevelArgs(selectedTool.inputsJsonSchema) : []),
    [selectedTool]
  )

  // Initialize on open / edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-init only when the dialog opens or the edit target changes.
  useEffect(() => {
    if (!open) return
    if (editing) {
      setRegisteredName(editing.registeredName)
      setDraft({ ...(agent.toolRestrictions?.[editing.registeredName] ?? {}) })
      setStep('args')
    } else {
      setRegisteredName(null)
      setDraft({})
      setStep('tool')
    }
  }, [open, editing])

  const handleSelectTool = (chipId: string) => {
    // ToolReferenceList emits `tool:<registeredName>` — the chip tail IS the
    // binding-map key, no catalog→registered translation needed.
    const resolved = chipId.replace(/^tool:/, '')
    if (!toolMeta.byRegisteredName.has(resolved)) return
    setRegisteredName(resolved)
    setDraft({ ...(agent.toolRestrictions?.[resolved] ?? {}) })
    setStep('args')
  }

  const setRow = (arg: string, next: VarSource) => setDraft((d) => ({ ...d, [arg]: next }))

  const canSave = !!registeredName && !Object.values(draft).some((s) => isIncomplete(s))

  const handleSave = () => {
    if (!registeredName) return
    const byArg: Record<string, VarSource> = {}
    for (const [arg, source] of Object.entries(draft)) {
      // Prune model-decides — it means "no override, inherit the author default".
      if (source.kind === 'model') continue
      byArg[arg] = source
    }
    onSave(registeredName, byArg)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title='Add override'
            description='Pick a tool, then override an input — pin a fixed value or bind it to the visitor. Untouched inputs keep their built-in scoping.'
            onBack={step === 'args' && !editing ? () => setStep('tool') : undefined}
            crumbs={[
              {
                label: step === 'tool' ? 'Add override' : (selectedTool?.displayName ?? 'Bindings'),
                icon:
                  step === 'args' && selectedTool ? (
                    <EntityIcon iconId={selectedTool.iconId} size='xs' />
                  ) : undefined,
              },
            ]}
          />

          {/* Body — width/height springs between steps */}
          <DialogNavPages value={step}>
            <DialogNavPage value='tool' size='md'>
              <div className='p-3'>
                <ToolReferenceList
                  filterNames={toolMeta.enabledToolNames}
                  onSelectSingle={handleSelectTool}
                  className='border'
                />
              </div>
            </DialogNavPage>

            <DialogNavPage value='args' size='md'>
              <ScrollArea viewportClassName='max-h-[28rem]'>
                <div className='p-3'>
                  <p className='pb-2 text-muted-foreground text-xs'>
                    Override an input, or leave it for its built-in scoping / the model.
                  </p>
                  {args.length === 0 ? (
                    <p className='px-2 py-4 text-sm text-muted-foreground'>
                      This tool has no top-level inputs.
                    </p>
                  ) : (
                    <FieldPanel className='p-0' resizeId='agent-binding' breakpoint='md'>
                      {args.map((arg) => {
                        const mapped = argToFieldType(arg.schema)
                        const source = draft[arg.name] ?? MODEL_DECIDES

                        return (
                          <FieldPanelRow
                            key={arg.name}
                            title={arg.name}
                            description={arg.schema.description}
                            icon={fieldTypeIcon(mapped.supported ? mapped.fieldType : undefined)}
                            showIcon
                            onClear={
                              source.kind !== 'model'
                                ? () => setRow(arg.name, { kind: 'model' })
                                : undefined
                            }>
                            {mapped.supported ? (
                              <BindingValueEditor
                                source={source}
                                onChange={(next) => setRow(arg.name, next)}
                                argFieldType={mapped.fieldType}
                                fieldOptions={mapped.options}
                              />
                            ) : (
                              <p className='py-2 text-xs italic text-muted-foreground'>
                                {mapped.reason}
                              </p>
                            )}
                          </FieldPanelRow>
                        )
                      })}
                    </FieldPanel>
                  )}
                </div>
              </ScrollArea>
            </DialogNavPage>
          </DialogNavPages>

          {/* Footer */}
          <DialogFooter className='mt-0 p-3 pt-0'>
            <Button size='sm' variant='ghost' onClick={() => onOpenChange(false)}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {step === 'args' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleSave}
                disabled={!canSave}
                data-dialog-submit>
                {editing ? 'Save' : 'Add override'} <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
