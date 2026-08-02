// apps/web/src/components/record-rules/ui/record-rule-actions-page.tsx

'use client'

import { FieldType } from '@auxx/database/enums'
import { tryParsePlaceholderId } from '@auxx/lib/placeholders/client'
import {
  ACTION_TOKEN_RECORD_NAME,
  actionDocToSummaryText,
  isActionDoc,
  type RecordRuleAction,
  SIGNAL_CONTEXT_TOKENS,
} from '@auxx/lib/record-rules/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { docToText, isNonEmptyDoc } from '@auxx/lib/tiptap'
import { type ActorId, getActorRawId, toActorId } from '@auxx/types/actor'
import type { SelectOption } from '@auxx/types/custom-field'
import { isFieldPath } from '@auxx/types/field'
import { Bell, ListTodo, PenLine, Workflow } from 'lucide-react'
import { type ComponentType, type ReactNode, useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import {
  firstSelectValue,
  RULE_ACTION_TRIGGER_PROPS,
  type RuleActionCatalogEntry,
  RuleActionsPage,
} from '~/components/rules/ui/rule-actions-page'
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

type ActionOfType<T extends EditableRuleAction['type']> = Extract<EditableRuleAction, { type: T }>

/**
 * Display label per action type. Exported so the configure page's drill-in
 * summary row names the same things the catalog does — the catalog itself is
 * built in a `useMemo` over fields/workflows and isn't reachable from there.
 */
export const RECORD_RULE_ACTION_LABELS: Record<EditableRuleAction['type'], string> = {
  notify: 'Notify members',
  'set-field': 'Set field',
  'enqueue-workflow': 'Run workflow',
  'create-task': 'Create task',
}

/**
 * Doc-aware completeness for token-bearing action fields. `isNonEmptyDoc` alone would
 * reject a doc whose only content is a placeholder chip (it counts text/reference/mention
 * nodes, not `placeholder`), so a token-only doc is rescued via `docToText`, which renders
 * placeholder nodes as `{{id}}`.
 */
function hasActionContent(v: unknown): boolean {
  return isActionDoc(v) && (isNonEmptyDoc(v) || docToText(v) !== '')
}

/**
 * Builds one catalog entry, narrowing the action to its own variant for the callbacks —
 * the shared editor only ever hands an entry an action whose `type` matches it.
 */
function actionEntry<T extends EditableRuleAction['type']>(
  type: T,
  config: {
    label: string
    icon: ComponentType<{ className?: string }>
    makeDefault: () => ActionOfType<T>
    validate: (action: ActionOfType<T>) => boolean
    summarize: (action: ActionOfType<T>) => string
    renderForm: (action: ActionOfType<T>, onChange: (next: ActionOfType<T>) => void) => ReactNode
  }
): RuleActionCatalogEntry<EditableRuleAction> {
  return {
    type,
    label: config.label,
    icon: config.icon,
    makeDefault: config.makeDefault,
    validate: (action) => config.validate(action as ActionOfType<T>),
    summarize: (action) => config.summarize(action as ActionOfType<T>),
    renderForm: (action, onChange) => config.renderForm(action as ActionOfType<T>, onChange),
  }
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
 * The record-rule action catalog — labels, defaults, validation, summaries and detail
 * forms for `notify` / `set-field` / `enqueue-workflow` / `create-task` — rendered
 * through the shared {@link RuleActionsPage} master-detail editor.
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
  const workflowOptions: SelectOption[] = useMemo(
    () => workflows.map((w) => ({ value: w.id, label: w.name })),
    [workflows]
  )

  const catalog = useMemo<RuleActionCatalogEntry<EditableRuleAction>[]>(() => {
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

    return [
      actionEntry('notify', {
        label: RECORD_RULE_ACTION_LABELS.notify,
        icon: Bell,
        makeDefault: () => ({ type: 'notify', userIds: [], message: emptyActionDoc() }),
        validate: (action) => action.userIds.length > 0 && hasActionContent(action.message),
        summarize: (action) =>
          action.userIds.length > 0
            ? `${action.userIds.length} member${action.userIds.length === 1 ? '' : 's'}`
            : 'No members',
        renderForm: (action, onChange) => (
          <>
            <FieldPanelRow title='Members' isRequired>
              <FieldInputAdapter
                fieldType={FieldType.ACTOR}
                fieldOptions={{ actor: { target: 'user', multiple: true } }}
                triggerProps={RULE_ACTION_TRIGGER_PROPS}
                value={action.userIds.map((id) => toActorId('user', id))}
                onChange={(v) =>
                  onChange({ ...action, userIds: (v as ActorId[]).map(getActorRawId) })
                }
                placeholder='Add members to notify'
              />
            </FieldPanelRow>
            <FieldPanelRow title='Message' isRequired description='Type { to insert a field…'>
              <ActionTokenInput
                value={action.message}
                onChange={(doc) => onChange({ ...action, message: doc })}
                entityDefinitionId={entityDefinitionId}
                fields={fields}
                isSignalRule={isSignalRule}
                placeholder='Notification message'
              />
            </FieldPanelRow>
          </>
        ),
      }),

      actionEntry('set-field', {
        label: RECORD_RULE_ACTION_LABELS['set-field'],
        icon: PenLine,
        makeDefault: () => ({ type: 'set-field', fieldRef: '', value: emptyActionDoc() }),
        validate: (action) => !!action.fieldRef,
        summarize: (action) =>
          action.fieldRef
            ? (fields.find((f) => (f.systemAttribute ?? String(f.id)) === action.fieldRef)?.label ??
              action.fieldRef)
            : 'No field',
        renderForm: (action, onChange) => (
          <>
            <FieldPanelRow title='Field' isRequired>
              <RecordRuleFieldRefInput
                entityDefinitionId={entityDefinitionId}
                fields={fields}
                value={action.fieldRef}
                onChange={(ref) => onChange({ ...action, fieldRef: ref })}
                placeholder='Field to set'
              />
            </FieldPanelRow>
            <FieldPanelRow title='Value' description='Type { to insert a field…'>
              <ActionTokenInput
                value={action.value}
                onChange={(doc) => onChange({ ...action, value: doc })}
                entityDefinitionId={entityDefinitionId}
                fields={fields}
                isSignalRule={isSignalRule}
                placeholder='Value'
              />
            </FieldPanelRow>
          </>
        ),
      }),

      actionEntry('enqueue-workflow', {
        label: RECORD_RULE_ACTION_LABELS['enqueue-workflow'],
        icon: Workflow,
        makeDefault: () => ({ type: 'enqueue-workflow', workflowAppId: '' }),
        validate: (action) => !!action.workflowAppId,
        summarize: (action) =>
          workflows.find((w) => w.id === action.workflowAppId)?.name || 'No workflow',
        renderForm: (action, onChange) => (
          <FieldPanelRow title='Workflow' isRequired>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: workflowOptions }}
              triggerProps={RULE_ACTION_TRIGGER_PROPS}
              value={action.workflowAppId}
              onChange={(v) => onChange({ ...action, workflowAppId: firstSelectValue(v) })}
              placeholder='Select workflow'
            />
          </FieldPanelRow>
        ),
      }),

      actionEntry('create-task', {
        label: RECORD_RULE_ACTION_LABELS['create-task'],
        icon: ListTodo,
        makeDefault: () => ({ type: 'create-task', title: emptyActionDoc() }),
        validate: (action) => hasActionContent(action.title),
        summarize: (action) =>
          actionDocToSummaryText(action.title, resolveTokenLabel) || 'No title',
        renderForm: (action, onChange) => (
          <CreateTaskActionForm
            action={action}
            onChange={onChange}
            entityDefinitionId={entityDefinitionId}
            fields={fields}
            isSignalRule={isSignalRule}
          />
        ),
      }),
    ]
  }, [entityDefinitionId, fields, isSignalRule, workflows, workflowOptions])

  return (
    <RuleActionsPage
      actions={actions}
      catalog={catalog}
      selectedIndex={selectedIndex}
      onSelectedIndexChange={onSelectedIndexChange}
      onAdd={onAdd}
      onRemove={onRemove}
      onUpdate={onUpdate}
      resizeId='record-rule'
      canSave={canSave}
      isPending={isPending}
      saveLabel={isEdit ? 'Save changes' : 'Create rule'}
      onSave={onSave}
      onCancel={onCancel}
    />
  )
}
