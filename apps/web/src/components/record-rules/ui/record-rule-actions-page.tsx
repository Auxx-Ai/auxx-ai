// apps/web/src/components/record-rules/ui/record-rule-actions-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { RecordRuleAction } from '@auxx/lib/record-rules/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import type { SelectOption } from '@auxx/types/custom-field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Bell, PenLine, Plus, Settings2, Trash2, Workflow, Zap } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { RecordRuleFieldRefInput } from './record-rule-field-ref-input'

/** A published workflow from `api.workflow.list`. */
interface WorkflowOption {
  id: string
  name: string
}

const ACTION_LABELS: Record<RecordRuleAction['type'], string> = {
  notify: 'Notify members',
  'set-field': 'Set field',
  'enqueue-workflow': 'Run workflow',
}

const ACTION_TYPE_OPTIONS: SelectOption[] = (
  Object.keys(ACTION_LABELS) as RecordRuleAction['type'][]
).map((type) => ({ value: type, label: ACTION_LABELS[type] }))

/** The flush-in-a-FieldPanelRow trigger sizing shared by every action input. */
const TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' } as const

function ActionIcon({ type }: { type: RecordRuleAction['type'] }): ReactNode {
  if (type === 'notify') return <Bell className='size-4' />
  if (type === 'set-field') return <PenLine className='size-4' />
  return <Workflow className='size-4' />
}

/** SINGLE_SELECT/ACTOR adapters emit arrays; take the first value. */
function first(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : ''
}

/** 'true'/'false'/numeric strings become their typed values; everything else stays a string. */
function coerceValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

interface RecordRuleActionsPageProps {
  actions: RecordRuleAction[]
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onUpdate: (index: number, action: RecordRuleAction) => void
  entityDefinitionId: string
  fields: ResourceField[]
  workflows: WorkflowOption[]
  isEdit: boolean
  canSave: boolean
  isPending: boolean
  onSave: () => void
  onCancel: () => void
}

/**
 * The rule's ordered action list as a master-detail page: a `TreeRow` list of actions with
 * a shared `FieldPanel` editor below for the selected one — mirroring the webhook topics page.
 */
export function RecordRuleActionsPage({
  actions,
  selectedIndex,
  onSelectedIndexChange,
  onAdd,
  onRemove,
  onUpdate,
  entityDefinitionId,
  fields,
  workflows,
  isEdit,
  canSave,
  isPending,
  onSave,
  onCancel,
}: RecordRuleActionsPageProps) {
  const selected = actions[selectedIndex] ?? null

  const workflowOptions: SelectOption[] = useMemo(
    () => workflows.map((w) => ({ value: w.id, label: w.name })),
    [workflows]
  )

  const summarize = (action: RecordRuleAction): string => {
    if (action.type === 'notify')
      return action.userIds.length > 0
        ? `${action.userIds.length} member${action.userIds.length === 1 ? '' : 's'}`
        : 'No members'
    if (action.type === 'set-field')
      return action.fieldRef
        ? (fields.find((f) => (f.systemAttribute ?? String(f.id)) === action.fieldRef)?.label ??
            action.fieldRef)
        : 'No field'
    return workflows.find((w) => w.id === action.workflowAppId)?.name || 'No workflow'
  }

  return (
    <form
      className='flex flex-col p-0'
      onSubmit={(e) => {
        e.preventDefault()
        if (canSave) onSave()
      }}>
      <Section
        title='Actions'
        icon={<Zap className='size-4' />}
        collapsible={false}
        actions={
          <Button variant='ghost' size='xs' onClick={onAdd}>
            <Plus />
            Add action
          </Button>
        }>
        {actions.length === 0 && (
          <EmptySection
            icon={<Zap className='size-5' />}
            title='No actions yet'
            description='Add an action to run when the rule fires.'
          />
        )}
        <div className='flex flex-col gap-0.5'>
          {actions.map((action, i) => (
            <TreeRow
              key={i}
              icon={<ActionIcon type={action.type} />}
              isOpen={selectedIndex === i}
              onToggleOpen={() => onSelectedIndexChange(i)}
              rowClassName={
                selectedIndex === i
                  ? 'bg-primary-100 hover:bg-primary-150'
                  : 'bg-primary-50 hover:bg-primary-100'
              }
              title={<span className='text-sm'>{ACTION_LABELS[action.type]}</span>}
              secondary={<span className='text-xs text-muted-foreground'>{summarize(action)}</span>}
              actions={
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Delete action'
                  onClick={() => onRemove(i)}>
                  <Trash2 />
                </TreeRowButton>
              }
            />
          ))}
        </div>
      </Section>

      <Section
        title={selected ? `Configure · ${ACTION_LABELS[selected.type]}` : 'Configure'}
        icon={<Settings2 className='size-4' />}
        collapsible={false}>
        {!selected ? (
          <EmptySection
            icon={<Settings2 className='size-5' />}
            title='No action selected'
            description='Select an action to configure it.'
          />
        ) : (
          <FieldPanel className='p-0' breakpoint='md' resizeId='record-rule'>
            <FieldPanelRow title='Action' isRequired>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: ACTION_TYPE_OPTIONS }}
                triggerProps={TRIGGER_PROPS}
                value={selected.type}
                onChange={(v) => {
                  const type = first(v) as RecordRuleAction['type']
                  if (type === 'set-field')
                    onUpdate(selectedIndex, { type: 'set-field', fieldRef: '', value: '' })
                  else if (type === 'enqueue-workflow')
                    onUpdate(selectedIndex, { type: 'enqueue-workflow', workflowAppId: '' })
                  else onUpdate(selectedIndex, { type: 'notify', userIds: [], message: '' })
                }}
              />
            </FieldPanelRow>

            {selected.type === 'notify' && (
              <>
                <FieldPanelRow title='Members' isRequired>
                  <FieldInputAdapter
                    fieldType={FieldType.ACTOR}
                    fieldOptions={{ actor: { target: 'user', multiple: true } }}
                    triggerProps={TRIGGER_PROPS}
                    value={selected.userIds.map((id) => toActorId('user', id))}
                    onChange={(v) =>
                      onUpdate(selectedIndex, {
                        ...selected,
                        userIds: (v as ActorId[]).map(getActorRawId),
                      })
                    }
                    placeholder='Add members to notify'
                  />
                </FieldPanelRow>
                <FieldPanelRow title='Message' isRequired>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={selected.message}
                    onChange={(v) =>
                      onUpdate(selectedIndex, { ...selected, message: String(v ?? '') })
                    }
                    placeholder='Notification message'
                  />
                </FieldPanelRow>
              </>
            )}

            {selected.type === 'set-field' && (
              <>
                <FieldPanelRow title='Field' isRequired>
                  <RecordRuleFieldRefInput
                    entityDefinitionId={entityDefinitionId}
                    fields={fields}
                    value={selected.fieldRef}
                    onChange={(ref) => onUpdate(selectedIndex, { ...selected, fieldRef: ref })}
                    placeholder='Field to set'
                  />
                </FieldPanelRow>
                <FieldPanelRow title='Value'>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={String(selected.value ?? '')}
                    onChange={(v) =>
                      onUpdate(selectedIndex, { ...selected, value: coerceValue(String(v ?? '')) })
                    }
                    placeholder='Value'
                  />
                </FieldPanelRow>
              </>
            )}

            {selected.type === 'enqueue-workflow' && (
              <FieldPanelRow title='Workflow' isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.SINGLE_SELECT}
                  fieldOptions={{ options: workflowOptions }}
                  triggerProps={TRIGGER_PROPS}
                  value={selected.workflowAppId}
                  onChange={(v) =>
                    onUpdate(selectedIndex, { ...selected, workflowAppId: first(v) })
                  }
                  placeholder='Select workflow'
                />
              </FieldPanelRow>
            )}
          </FieldPanel>
        )}
      </Section>

      <DialogFooter className='p-3'>
        <Button variant='ghost' size='sm' type='button' onClick={onCancel}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          type='submit'
          disabled={!canSave}
          loading={isPending}
          loadingText='Saving...'>
          {isEdit ? 'Save changes' : 'Create rule'} <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </form>
  )
}
