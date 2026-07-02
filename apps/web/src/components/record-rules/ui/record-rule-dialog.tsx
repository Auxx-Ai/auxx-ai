// apps/web/src/components/record-rules/ui/record-rule-dialog.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  FIELD_TRANSITIONS,
  LIFECYCLE_TRANSITIONS,
  type RecordRuleAction,
  type RecordRuleOn,
} from '@auxx/lib/record-rules/client'
import { getFieldOperators, type ResourceField } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
} from '~/components/conditions'
import { api } from '~/trpc/react'
import { useRecordRules } from '../hooks/use-record-rules'

const EMPTY_CONDITIONS: Condition[] = []

const ON_LABELS: Record<RecordRuleOn, string> = {
  changed: 'Field changed',
  increased: 'Field increased',
  decreased: 'Field decreased',
  set: 'Field set (was empty)',
  cleared: 'Field cleared',
  created: 'Record created',
  deleted: 'Record deleted',
}

/** Rule shape the settings list hands to the dialog (router `list` output item). */
export interface EditableRecordRule {
  id: string
  entityDefinitionId: string
  fieldRef: string | null
  name: string
  on: string
  condition: unknown
  actions: unknown
  enabled: boolean
}

interface RecordRuleDialogProps {
  open: boolean
  onClose: () => void
  rule?: EditableRecordRule | null
}

/** 'true'/'false'/numeric strings become their typed values; everything else stays a string. */
function coerceValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

/**
 * Create/edit dialog for a record rule: definition + trigger + optional watched
 * field, the shared condition builder, and an ordered action list.
 */
export function RecordRuleDialog({ open, onClose, rule }: RecordRuleDialogProps) {
  const { create, update } = useRecordRules()
  const { data: resources } = api.resource.list.useQuery(undefined, { staleTime: 60_000 })
  const { data: workflowData } = api.workflow.list.useQuery({}, { staleTime: 60_000 })
  const { data: memberData } = api.member.all.useQuery(undefined, { staleTime: 60_000 })

  const [name, setName] = useState('')
  const [entityDefinitionId, setEntityDefinitionId] = useState('')
  const [on, setOn] = useState<RecordRuleOn>('changed')
  const [fieldRef, setFieldRef] = useState('')
  const [groups, setGroups] = useState<ConditionGroup[]>([])
  const [actions, setActions] = useState<RecordRuleAction[]>([])

  // Re-seed form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setName(rule?.name ?? '')
    setEntityDefinitionId(rule?.entityDefinitionId ?? '')
    setOn((rule?.on as RecordRuleOn) ?? 'changed')
    setFieldRef(rule?.fieldRef ?? '')
    setGroups(Array.isArray(rule?.condition) ? (rule.condition as ConditionGroup[]) : [])
    setActions(Array.isArray(rule?.actions) ? (rule.actions as RecordRuleAction[]) : [])
  }, [open, rule])

  const isLifecycle = LIFECYCLE_TRANSITIONS.includes(on)

  const definitionOptions = useMemo(
    () => (resources ?? []).filter((r) => r.entityDefinitionId),
    [resources]
  )
  const selectedResource = definitionOptions.find(
    (r) => r.entityDefinitionId === entityDefinitionId
  )
  const fields: ResourceField[] = useMemo(() => selectedResource?.fields ?? [], [selectedResource])

  /** Ref sent to the server — systemAttribute when present (resolves everywhere), else row id. */
  const fieldRefFor = (field: ResourceField) => field.systemAttribute ?? String(field.id)

  const workflows = (workflowData?.workflows ?? []).filter((w: { enabled?: boolean }) => w.enabled)
  const members = memberData?.members ?? []

  // Condition builder wiring — mirrors the table filter builder.
  const fieldDefinitions = useMemo(
    () =>
      fields.map((field) => ({
        id: field.resourceFieldId ?? String(field.id),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
        operators: field.operatorOverrides || getFieldOperators(field),
        options: field.options,
      })),
    [fields]
  )

  const conditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      entityDefinitionId,
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      defaultGroupName: 'Condition',
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: true,
    }),
    [entityDefinitionId, fieldDefinitions]
  )

  const updateAction = (index: number, next: RecordRuleAction) =>
    setActions((prev) => prev.map((a, i) => (i === index ? next : a)))
  const removeAction = (index: number) => setActions((prev) => prev.filter((_, i) => i !== index))
  const addAction = () =>
    setActions((prev) => [...prev, { type: 'notify', userIds: [], message: '' }])

  const isPending = create.isPending || update.isPending
  const canSave =
    name.trim() !== '' &&
    entityDefinitionId !== '' &&
    (isLifecycle || fieldRef !== '') &&
    actions.length > 0

  const handleSave = async () => {
    const invalidNotify = actions.find(
      (a) => a.type === 'notify' && (a.userIds.length === 0 || a.message.trim() === '')
    )
    const invalidSetField = actions.find((a) => a.type === 'set-field' && !a.fieldRef)
    const invalidWorkflow = actions.find((a) => a.type === 'enqueue-workflow' && !a.workflowAppId)
    if (invalidNotify || invalidSetField || invalidWorkflow) {
      toastError({
        title: 'Incomplete action',
        description: 'Every action needs its target and content filled in.',
      })
      return
    }

    const payload = {
      entityDefinitionId,
      fieldRef: isLifecycle ? null : fieldRef,
      name: name.trim(),
      on,
      condition: groups.filter((g) => g.conditions.length > 0) as unknown as Record<
        string,
        unknown
      >[],
      actions,
      enabled: rule?.enabled ?? true,
    }
    if (rule) {
      await update.mutateAsync({ ruleId: rule.id, ...payload })
    } else {
      await create.mutateAsync(payload)
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='lg' position='tc' className='max-h-[85vh] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='rule-name'>Name</Label>
            <Input
              id='rule-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g. Notify on urgent tickets'
            />
          </div>

          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <div className='flex flex-col gap-2'>
              <Label>Record type</Label>
              <Select
                value={entityDefinitionId}
                onValueChange={(v) => {
                  setEntityDefinitionId(v)
                  setFieldRef('')
                  setGroups([])
                }}>
                <SelectTrigger>
                  <SelectValue placeholder='Select record type' />
                </SelectTrigger>
                <SelectContent>
                  {definitionOptions.map((r) => (
                    <SelectItem key={r.entityDefinitionId} value={r.entityDefinitionId}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='flex flex-col gap-2'>
              <Label>Trigger</Label>
              <Select
                value={on}
                onValueChange={(v) => {
                  const next = v as RecordRuleOn
                  setOn(next)
                  if (LIFECYCLE_TRANSITIONS.includes(next)) setFieldRef('')
                }}>
                <SelectTrigger>
                  <SelectValue placeholder='Select trigger' />
                </SelectTrigger>
                <SelectContent>
                  {[...FIELD_TRANSITIONS, ...LIFECYCLE_TRANSITIONS].map((value) => (
                    <SelectItem key={value} value={value}>
                      {ON_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isLifecycle && (
            <div className='flex flex-col gap-2'>
              <Label>Watched field</Label>
              <Select value={fieldRef} onValueChange={setFieldRef} disabled={!entityDefinitionId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={entityDefinitionId ? 'Select field' : 'Select a record type first'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((field) => (
                    <SelectItem key={String(field.id)} value={fieldRefFor(field)}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className='flex flex-col gap-2'>
            <Label>Conditions</Label>
            {entityDefinitionId ? (
              <div className='rounded-md border p-2'>
                <ConditionProvider
                  conditions={EMPTY_CONDITIONS}
                  groups={groups}
                  config={conditionConfig}
                  onConditionsChange={() => {}}
                  onGroupsChange={setGroups}
                  getAvailableFields={() => fieldDefinitions}
                  getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
                  <ConditionContainer
                    emptyStateText='No conditions — the rule always runs'
                    showAddButton
                    showGrouping
                  />
                </ConditionProvider>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>Select a record type first.</p>
            )}
          </div>

          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
              <Label>Actions (run in order)</Label>
              <Button variant='outline' size='sm' onClick={addAction}>
                <Plus />
                Add action
              </Button>
            </div>

            {actions.length === 0 && (
              <p className='text-sm text-muted-foreground'>Add at least one action.</p>
            )}

            {actions.map((action, index) => (
              <div key={`action-${index}`} className='flex flex-col gap-2 rounded-md border p-3'>
                <div className='flex items-center gap-2'>
                  <Select
                    value={action.type}
                    onValueChange={(type) => {
                      if (type === 'set-field')
                        updateAction(index, { type: 'set-field', fieldRef: '', value: '' })
                      else if (type === 'enqueue-workflow')
                        updateAction(index, { type: 'enqueue-workflow', workflowAppId: '' })
                      else updateAction(index, { type: 'notify', userIds: [], message: '' })
                    }}>
                    <SelectTrigger className='w-44'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='notify'>Notify members</SelectItem>
                      <SelectItem value='set-field'>Set field</SelectItem>
                      <SelectItem value='enqueue-workflow'>Run workflow</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className='flex-1' />
                  <Button variant='ghost' size='icon-sm' onClick={() => removeAction(index)}>
                    <Trash2 />
                  </Button>
                </div>

                {action.type === 'set-field' && (
                  <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                    <Select
                      value={action.fieldRef}
                      onValueChange={(v) => updateAction(index, { ...action, fieldRef: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder='Field to set' />
                      </SelectTrigger>
                      <SelectContent>
                        {fields.map((field) => (
                          <SelectItem key={String(field.id)} value={fieldRefFor(field)}>
                            {field.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={String(action.value ?? '')}
                      onChange={(e) =>
                        updateAction(index, { ...action, value: coerceValue(e.target.value) })
                      }
                      placeholder='Value'
                    />
                  </div>
                )}

                {action.type === 'enqueue-workflow' && (
                  <Select
                    value={action.workflowAppId}
                    onValueChange={(v) => updateAction(index, { ...action, workflowAppId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder='Select workflow' />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((w: { id: string; name: string }) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {action.type === 'notify' && (
                  <div className='flex flex-col gap-2'>
                    <Select
                      value=''
                      onValueChange={(userId) => {
                        if (!action.userIds.includes(userId))
                          updateAction(index, { ...action, userIds: [...action.userIds, userId] })
                      }}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            action.userIds.length > 0
                              ? `${action.userIds.length} member${action.userIds.length === 1 ? '' : 's'} selected`
                              : 'Add members to notify'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {members.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.user?.name || m.user?.email || m.userId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {action.userIds.length > 0 && (
                      <div className='flex flex-wrap gap-1'>
                        {action.userIds.map((userId) => {
                          const member = members.find((m) => m.userId === userId)
                          return (
                            <Button
                              key={userId}
                              variant='secondary'
                              size='sm'
                              onClick={() =>
                                updateAction(index, {
                                  ...action,
                                  userIds: action.userIds.filter((id) => id !== userId),
                                })
                              }>
                              {member?.user?.name || member?.user?.email || userId} ×
                            </Button>
                          )
                        })}
                      </div>
                    )}
                    <Input
                      value={action.message}
                      onChange={(e) => updateAction(index, { ...action, message: e.target.value })}
                      placeholder='Notification message'
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!canSave}
            loading={isPending}
            loadingText='Saving...'>
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
