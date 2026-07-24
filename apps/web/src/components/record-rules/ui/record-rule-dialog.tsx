// apps/web/src/components/record-rules/ui/record-rule-dialog.tsx

'use client'

import type { Condition, ConditionGroup } from '@auxx/lib/conditions/client'
import {
  isActionDoc,
  LIFECYCLE_TRANSITIONS,
  type RecordRuleOn,
} from '@auxx/lib/record-rules/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { isSignalPseudoFieldId } from '@auxx/lib/signals/client'
import { docToText, isNonEmptyDoc } from '@auxx/lib/tiptap'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { useRecordRules } from '../hooks/use-record-rules'
import { emptyActionDoc } from './action-token-input'
import { type EditableRuleAction, RecordRuleActionsPage } from './record-rule-actions-page'
import { RecordRuleConfigurePage } from './record-rule-configure-page'

/**
 * Doc-aware completeness for token-bearing action fields. `isNonEmptyDoc` alone would
 * reject a doc whose only content is a placeholder chip (it counts text/reference/mention
 * nodes, not `placeholder`), so a token-only doc is rescued via `docToText`, which renders
 * placeholder nodes as `{{id}}`.
 */
function hasActionContent(v: unknown): boolean {
  return isActionDoc(v) && (isNonEmptyDoc(v) || docToText(v) !== '')
}

/** Rule shape the settings list hands to the dialog (router `list` output item). */
export interface EditableRecordRule {
  id: string
  entityDefinitionId: string
  fieldRef: string | null
  name: string
  on: string
  /** The watched signal kind, e.g. `'email:opened'`. Non-null ⇔ `on === 'signal'`. */
  signalKind?: string | null
  condition: unknown
  actions: unknown
  enabled: boolean
  /** Non-null ⇒ feature-provisioned + locked (edit/delete disabled in the UI). */
  managed?: 'inventory' | null
}

/** Walk a condition tree, dropping any condition that targets a `signal:*` pseudo-field. */
function stripSignalCondition(condition: Condition): Condition | null {
  if (typeof condition.fieldId === 'string' && isSignalPseudoFieldId(condition.fieldId)) {
    return null
  }
  if (!condition.subConditions?.length) return condition
  return {
    ...condition,
    subConditions: condition.subConditions.flatMap((sub) => {
      const stripped = stripSignalCondition(sub)
      return stripped ? [stripped] : []
    }),
  }
}

/** Strip stale `signal:*` conditions left over from a signal rule (decision 15) — mirrors the
 * server's `assertRuleShape` rejection so switching the trigger away from `'signal'` doesn't
 * leave a rule that fails to save. */
function stripSignalConditions(groups: ConditionGroup[]): ConditionGroup[] {
  return groups.map((group) => ({
    ...group,
    conditions: group.conditions.flatMap((condition) => {
      const stripped = stripSignalCondition(condition)
      return stripped ? [stripped] : []
    }),
  }))
}

interface RecordRuleDialogProps {
  open: boolean
  onClose: () => void
  rule?: EditableRecordRule | null
}

/**
 * Create/edit dialog for a record rule. A two-page `DialogNav` flow: `configure`
 * (name, record type, trigger, watched field, conditions) → `actions` (the ordered
 * action editor). The shell owns all form state; the pages are presentational.
 */
export function RecordRuleDialog({ open, onClose, rule }: RecordRuleDialogProps) {
  const { create, update } = useRecordRules()
  const { canViewEntity } = useAccess()
  const { data: resources } = api.resource.list.useQuery(undefined, { staleTime: 60_000 })
  const { data: workflowData } = api.workflow.list.useQuery({}, { staleTime: 60_000 })

  const [page, setPage] = useState<'configure' | 'actions'>('configure')
  const [name, setName] = useState('')
  const [entityDefinitionId, setEntityDefinitionId] = useState('')
  const [on, setOn] = useState<RecordRuleOn>('changed')
  const [fieldRef, setFieldRef] = useState('')
  const [signalKind, setSignalKind] = useState('')
  const [groups, setGroups] = useState<ConditionGroup[]>([])
  const [actions, setActions] = useState<EditableRuleAction[]>([])
  const [selectedActionIndex, setSelectedActionIndex] = useState(0)

  // Re-seed form state whenever the dialog opens.
  useEffect(() => {
    if (!open) return
    setPage('configure')
    setSelectedActionIndex(0)
    setName(rule?.name ?? '')
    setEntityDefinitionId(rule?.entityDefinitionId ?? '')
    setOn((rule?.on as RecordRuleOn) ?? 'changed')
    setFieldRef(rule?.fieldRef ?? '')
    setSignalKind(rule?.signalKind ?? '')
    setGroups(Array.isArray(rule?.condition) ? (rule.condition as ConditionGroup[]) : [])
    setActions(Array.isArray(rule?.actions) ? (rule.actions as EditableRuleAction[]) : [])
  }, [open, rule])

  const isLifecycle = LIFECYCLE_TRANSITIONS.includes(on)

  // `api.resource.list` bypasses the store; scope the record-type choices to the
  // defs the member can view (per-def read gate) — mirrors the picker filter.
  const definitionOptions = useMemo(
    () =>
      (resources ?? []).filter((r) => r.entityDefinitionId && canViewEntity(r.entityDefinitionId)),
    [resources, canViewEntity]
  )
  const selectedResource = definitionOptions.find(
    (r) => r.entityDefinitionId === entityDefinitionId
  )
  const fields: ResourceField[] = useMemo(() => selectedResource?.fields ?? [], [selectedResource])
  // Decision 14 — "Signal received" only ever fires for contact-backed defs (signal payloads
  // only carry `contact:<id>` record keys today).
  const isContactDef = selectedResource?.entityType === 'contact'

  const workflows = useMemo(
    () => (workflowData?.workflows ?? []).filter((w: { enabled?: boolean }) => w.enabled),
    [workflowData]
  )

  const onDefinitionChange = (id: string) => {
    setEntityDefinitionId(id)
    setFieldRef('')
    setGroups([])
    // A signal trigger only makes sense on a contact-backed def — switching to a def that
    // isn't one falls back to the default field trigger (decision 14).
    const nextIsContactDef =
      definitionOptions.find((r) => r.entityDefinitionId === id)?.entityType === 'contact'
    if (on === 'signal' && !nextIsContactDef) {
      setOn('changed')
      setSignalKind('')
    }
  }
  const onTriggerChange = (next: RecordRuleOn) => {
    setOn(next)
    if (LIFECYCLE_TRANSITIONS.includes(next)) setFieldRef('')
    if (next !== 'signal') {
      setSignalKind('')
      setGroups((prev) => stripSignalConditions(prev))
    }
  }

  const updateAction = (index: number, next: EditableRuleAction) =>
    setActions((prev) => prev.map((a, i) => (i === index ? next : a)))
  const removeAction = (index: number) =>
    setActions((prev) => {
      const next = prev.filter((_, i) => i !== index)
      setSelectedActionIndex((cur) => Math.max(0, Math.min(cur, next.length - 1)))
      return next
    })
  const addAction = () =>
    setActions((prev) => {
      const next: EditableRuleAction[] = [
        ...prev,
        { type: 'notify', userIds: [], message: emptyActionDoc() },
      ]
      setSelectedActionIndex(next.length - 1)
      return next
    })

  const isPending = create.isPending || update.isPending
  const isSignal = on === 'signal'
  const canGoToActions =
    name.trim() !== '' &&
    entityDefinitionId !== '' &&
    (isLifecycle || (isSignal ? signalKind !== '' : fieldRef !== ''))
  const canSave = canGoToActions && actions.length > 0

  const handleSave = async () => {
    const invalidIndex = actions.findIndex(
      (a) =>
        (a.type === 'notify' && (a.userIds.length === 0 || !hasActionContent(a.message))) ||
        (a.type === 'set-field' && !a.fieldRef) ||
        (a.type === 'enqueue-workflow' && !a.workflowAppId) ||
        (a.type === 'create-task' && !hasActionContent(a.title))
    )
    if (invalidIndex >= 0) {
      setSelectedActionIndex(invalidIndex)
      setPage('actions')
      toastError({
        title: 'Incomplete action',
        description: 'Every action needs its target and content filled in.',
      })
      return
    }

    const payload = {
      entityDefinitionId,
      fieldRef: isLifecycle || isSignal ? null : fieldRef,
      name: name.trim(),
      on,
      signalKind: isSignal ? signalKind : null,
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
      <DialogContent size='content' position='tc' innerClassName='p-0'>
        <DialogNav
          title={rule ? 'Edit rule' : 'New rule'}
          description='React to record changes with conditions and actions.'
          onBack={page === 'actions' ? () => setPage('configure') : undefined}
          crumbs={[
            {
              label: name.trim() || (rule ? 'Rule' : 'New rule'),
              onClick: page !== 'configure' ? () => setPage('configure') : undefined,
            },
            ...(page === 'actions' ? [{ label: 'Actions' }] : []),
          ]}
        />

        <DialogNavPages value={page}>
          <DialogNavPage value='configure' size='lg'>
            <RecordRuleConfigurePage
              name={name}
              onNameChange={setName}
              entityDefinitionId={entityDefinitionId}
              onDefinitionChange={onDefinitionChange}
              on={on}
              onTriggerChange={onTriggerChange}
              fieldRef={fieldRef}
              onFieldRefChange={setFieldRef}
              signalKind={signalKind}
              onSignalKindChange={setSignalKind}
              groups={groups}
              onGroupsChange={setGroups}
              fields={fields}
              isLifecycle={isLifecycle}
              isContactDef={isContactDef}
              canContinue={canGoToActions}
              onContinue={() => setPage('actions')}
              onCancel={onClose}
            />
          </DialogNavPage>

          <DialogNavPage value='actions' size='lg'>
            <RecordRuleActionsPage
              actions={actions}
              selectedIndex={selectedActionIndex}
              onSelectedIndexChange={setSelectedActionIndex}
              onAdd={addAction}
              onRemove={removeAction}
              onUpdate={updateAction}
              entityDefinitionId={entityDefinitionId}
              fields={fields}
              isSignalRule={isSignal}
              workflows={workflows}
              isEdit={!!rule}
              canSave={canSave}
              isPending={isPending}
              onSave={() => void handleSave()}
              onCancel={onClose}
            />
          </DialogNavPage>
        </DialogNavPages>
      </DialogContent>
    </Dialog>
  )
}
