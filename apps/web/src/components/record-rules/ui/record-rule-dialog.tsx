// apps/web/src/components/record-rules/ui/record-rule-dialog.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import {
  LIFECYCLE_TRANSITIONS,
  type RecordRuleAction,
  type RecordRuleOn,
} from '@auxx/lib/record-rules/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { Dialog, DialogContent } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import { useRecordRules } from '../hooks/use-record-rules'
import { RecordRuleActionsPage } from './record-rule-actions-page'
import { RecordRuleConfigurePage } from './record-rule-configure-page'

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
  /** Non-null ⇒ feature-provisioned + locked (edit/delete disabled in the UI). */
  managed?: 'inventory' | null
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
  const { data: resources } = api.resource.list.useQuery(undefined, { staleTime: 60_000 })
  const { data: workflowData } = api.workflow.list.useQuery({}, { staleTime: 60_000 })

  const [page, setPage] = useState<'configure' | 'actions'>('configure')
  const [name, setName] = useState('')
  const [entityDefinitionId, setEntityDefinitionId] = useState('')
  const [on, setOn] = useState<RecordRuleOn>('changed')
  const [fieldRef, setFieldRef] = useState('')
  const [groups, setGroups] = useState<ConditionGroup[]>([])
  const [actions, setActions] = useState<RecordRuleAction[]>([])
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

  const workflows = useMemo(
    () => (workflowData?.workflows ?? []).filter((w: { enabled?: boolean }) => w.enabled),
    [workflowData]
  )

  const onDefinitionChange = (id: string) => {
    setEntityDefinitionId(id)
    setFieldRef('')
    setGroups([])
  }
  const onTriggerChange = (next: RecordRuleOn) => {
    setOn(next)
    if (LIFECYCLE_TRANSITIONS.includes(next)) setFieldRef('')
  }

  const updateAction = (index: number, next: RecordRuleAction) =>
    setActions((prev) => prev.map((a, i) => (i === index ? next : a)))
  const removeAction = (index: number) =>
    setActions((prev) => {
      const next = prev.filter((_, i) => i !== index)
      setSelectedActionIndex((cur) => Math.max(0, Math.min(cur, next.length - 1)))
      return next
    })
  const addAction = () =>
    setActions((prev) => {
      const next: RecordRuleAction[] = [...prev, { type: 'notify', userIds: [], message: '' }]
      setSelectedActionIndex(next.length - 1)
      return next
    })

  const isPending = create.isPending || update.isPending
  const canGoToActions =
    name.trim() !== '' && entityDefinitionId !== '' && (isLifecycle || fieldRef !== '')
  const canSave = canGoToActions && actions.length > 0

  const handleSave = async () => {
    const invalidIndex = actions.findIndex(
      (a) =>
        (a.type === 'notify' && (a.userIds.length === 0 || a.message.trim() === '')) ||
        (a.type === 'set-field' && !a.fieldRef) ||
        (a.type === 'enqueue-workflow' && !a.workflowAppId)
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
              groups={groups}
              onGroupsChange={setGroups}
              fields={fields}
              isLifecycle={isLifecycle}
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
