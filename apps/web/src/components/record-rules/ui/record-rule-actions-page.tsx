// apps/web/src/components/record-rules/ui/record-rule-actions-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { tryParsePlaceholderId } from '@auxx/lib/placeholders/client'
import {
  ACTION_TOKEN_RECORD_NAME,
  actionDocToSummaryText,
  type RecordRuleAction,
  SIGNAL_CONTEXT_TOKENS,
} from '@auxx/lib/record-rules/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import type { SelectOption } from '@auxx/types/custom-field'
import { isFieldPath } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Bell, ListTodo, PenLine, Plus, Settings2, Trash2, Workflow, Zap } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { ActionTokenInput, emptyActionDoc } from './action-token-input'
import { CreateTaskActionForm } from './create-task-action-form'
import { RecordRuleFieldRefInput } from './record-rule-field-ref-input'

/** A published workflow from `api.workflow.list`. */
interface WorkflowOption {
  id: string
  name: string
}

/**
 * The action shapes the rule editor edits — `native` actions are server-declared only
 * (never accepted from the router or UI), so the editor's unions exclude them.
 */
export type EditableRuleAction = Exclude<RecordRuleAction, { type: 'native' }>

const ACTION_LABELS: Record<EditableRuleAction['type'], string> = {
  notify: 'Notify members',
  'set-field': 'Set field',
  'enqueue-workflow': 'Run workflow',
  'create-task': 'Create task',
}

const ACTION_TYPE_OPTIONS: SelectOption[] = (
  Object.keys(ACTION_LABELS) as EditableRuleAction['type'][]
).map((type) => ({ value: type, label: ACTION_LABELS[type] }))

/** The flush-in-a-FieldPanelRow trigger sizing shared by every action input. */
const TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' } as const

function ActionIcon({ type }: { type: EditableRuleAction['type'] }): ReactNode {
  if (type === 'notify') return <Bell className='size-4' />
  if (type === 'set-field') return <PenLine className='size-4' />
  if (type === 'create-task') return <ListTodo className='size-4' />
  return <Workflow className='size-4' />
}

/** SINGLE_SELECT/ACTOR adapters emit arrays; take the first value. */
function first(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : ''
}

interface RecordRuleActionsPageProps {
  actions: EditableRuleAction[]
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onUpdate: (index: number, action: EditableRuleAction) => void
  entityDefinitionId: string
  fields: ResourceField[]
  /** True on `on === 'signal'` rules — offers signal-context tokens in the token inputs. */
  isSignalRule: boolean
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
  isSignalRule,
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

  /** Token id → display label for `actionDocToSummaryText` — 'Record name', signal labels,
   * or the field's label (root-level tokens only; drilled paths degrade to the raw id). */
  const resolveTokenLabel = (id: string): string | undefined => {
    if (id === ACTION_TOKEN_RECORD_NAME) return 'Record name'
    const signalToken = SIGNAL_CONTEXT_TOKENS.find((t) => t.id === id)
    if (signalToken) return signalToken.label
    const parsed = tryParsePlaceholderId(id)
    if (parsed?.kind !== 'field') return undefined
    const terminal = isFieldPath(parsed.fieldRef) ? parsed.fieldRef.at(-1) : parsed.fieldRef
    return fields.find((f) => f.resourceFieldId === terminal)?.label
  }

  const summarize = (action: EditableRuleAction): string => {
    if (action.type === 'notify')
      return action.userIds.length > 0
        ? `${action.userIds.length} member${action.userIds.length === 1 ? '' : 's'}`
        : 'No members'
    if (action.type === 'set-field')
      return action.fieldRef
        ? (fields.find((f) => (f.systemAttribute ?? String(f.id)) === action.fieldRef)?.label ??
            action.fieldRef)
        : 'No field'
    if (action.type === 'create-task')
      return actionDocToSummaryText(action.title, resolveTokenLabel) || 'No title'
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
                  const type = first(v) as EditableRuleAction['type']
                  if (type === 'set-field')
                    onUpdate(selectedIndex, {
                      type: 'set-field',
                      fieldRef: '',
                      value: emptyActionDoc(),
                    })
                  else if (type === 'enqueue-workflow')
                    onUpdate(selectedIndex, { type: 'enqueue-workflow', workflowAppId: '' })
                  else if (type === 'create-task')
                    onUpdate(selectedIndex, { type: 'create-task', title: emptyActionDoc() })
                  else
                    onUpdate(selectedIndex, {
                      type: 'notify',
                      userIds: [],
                      message: emptyActionDoc(),
                    })
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
                <FieldPanelRow title='Message' isRequired description='Type { to insert a field…'>
                  <ActionTokenInput
                    value={selected.message}
                    onChange={(doc) => onUpdate(selectedIndex, { ...selected, message: doc })}
                    entityDefinitionId={entityDefinitionId}
                    fields={fields}
                    isSignalRule={isSignalRule}
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
                <FieldPanelRow title='Value' description='Type { to insert a field…'>
                  <ActionTokenInput
                    value={selected.value}
                    onChange={(doc) => onUpdate(selectedIndex, { ...selected, value: doc })}
                    entityDefinitionId={entityDefinitionId}
                    fields={fields}
                    isSignalRule={isSignalRule}
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

            {selected.type === 'create-task' && (
              <CreateTaskActionForm
                action={selected}
                onChange={(next) => onUpdate(selectedIndex, next)}
                entityDefinitionId={entityDefinitionId}
                fields={fields}
                isSignalRule={isSignalRule}
              />
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
