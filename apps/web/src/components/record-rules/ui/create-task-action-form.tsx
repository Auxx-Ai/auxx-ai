// apps/web/src/components/record-rules/ui/create-task-action-form.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import type { RecordRuleAction } from '@auxx/lib/record-rules/client'
import { getTaskFilterField } from '@auxx/lib/tasks/client'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import type { SelectOption } from '@auxx/types/custom-field'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'

/** The `create-task` variant of `RecordRuleAction` — the only shape this form edits. */
export type CreateTaskAction = Extract<RecordRuleAction, { type: 'create-task' }>

/** Mirrors the canonical priority options in `TASK_FILTER_FIELDS` (task filter config). */
const PRIORITY_OPTIONS: SelectOption[] = getTaskFilterField('priority')?.options ?? []

/** The flush-in-a-FieldPanelRow trigger sizing shared by every action input (matches the actions page). */
const TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' } as const

/** SINGLE_SELECT/ACTOR adapters emit arrays; take the first value. */
function first(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' ? v : ''
}

interface CreateTaskActionFormProps {
  action: CreateTaskAction
  onChange: (action: CreateTaskAction) => void
}

/**
 * `FieldPanelRow`s for a selected `create-task` rule action — title, assignees, relative
 * deadline, priority, and the reply auto-complete toggle (decision 11, v1 scope). Split out
 * of `RecordRuleActionsPage` to keep that file under the split threshold.
 */
export function CreateTaskActionForm({ action, onChange }: CreateTaskActionFormProps) {
  return (
    <>
      <FieldPanelRow title='Title' isRequired description="Use {{record}} for the record's name">
        <FieldInputAdapter
          fieldType={FieldType.TEXT}
          value={action.title}
          onChange={(v) => onChange({ ...action, title: String(v ?? '') })}
          placeholder='e.g. Follow up with {{record}}'
        />
      </FieldPanelRow>

      <FieldPanelRow title='Assignees' description='Leave empty to create the task unassigned.'>
        <FieldInputAdapter
          fieldType={FieldType.ACTOR}
          fieldOptions={{ actor: { target: 'user', multiple: true } }}
          triggerProps={TRIGGER_PROPS}
          value={(action.assigneeIds ?? []).map((id) => toActorId('user', id))}
          onChange={(v) =>
            onChange({ ...action, assigneeIds: (v as ActorId[]).map(getActorRawId) })
          }
          placeholder='Add assignees'
        />
      </FieldPanelRow>

      <FieldPanelRow
        title='Due in'
        description='Relative deadline in days from when the rule fires.'>
        <FieldInputAdapter
          fieldType={FieldType.NUMBER}
          value={action.deadlineDays ?? ''}
          onChange={(v) =>
            onChange({ ...action, deadlineDays: typeof v === 'number' ? v : undefined })
          }
          placeholder='No deadline'
        />
      </FieldPanelRow>

      <FieldPanelRow title='Priority'>
        <FieldInputAdapter
          fieldType={FieldType.SINGLE_SELECT}
          fieldOptions={{ options: PRIORITY_OPTIONS }}
          triggerProps={TRIGGER_PROPS}
          value={action.priority ?? ''}
          onChange={(v) =>
            onChange({
              ...action,
              priority: (first(v) || undefined) as CreateTaskAction['priority'],
            })
          }
          placeholder='No priority'
        />
      </FieldPanelRow>

      <FieldPanelRow title='Auto-complete' description='Complete the task when the contact replies'>
        <FieldInputAdapter
          fieldType={FieldType.CHECKBOX}
          fieldOptions={{ variant: 'switch' }}
          value={!!action.autoCompleteOn}
          onChange={(v) => onChange({ ...action, autoCompleteOn: v ? 'contact_reply' : undefined })}
        />
      </FieldPanelRow>
    </>
  )
}
