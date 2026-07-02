// apps/web/src/components/record-rules/ui/record-rules-section.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { ListCard, type ListCardMenuItem, renderBadgeChips } from '@auxx/ui/components/list-card'
import { History, Lock, Pencil, Plus, Trash, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useRecordRules } from '../hooks/use-record-rules'
import { type EditableRecordRule, RecordRuleDialog } from './record-rule-dialog'
import { RecordRuleRunsDialog } from './record-rule-runs-dialog'

type RuleRow = EditableRecordRule & { fieldLabel: string | null }

const ON_SUMMARY: Record<string, string> = {
  changed: 'changes',
  increased: 'increases',
  decreased: 'decreases',
  set: 'is set',
  cleared: 'is cleared',
  created: 'is created',
  deleted: 'is deleted',
}

/** "When Inventory Quantity decreases · 2 actions" */
function describeRule(rule: RuleRow, defLabel: string | undefined): string {
  const subject =
    rule.on === 'created' || rule.on === 'deleted'
      ? `a ${defLabel ?? 'record'}`
      : (rule.fieldLabel ?? 'a field')
  const actionCount = Array.isArray(rule.actions) ? rule.actions.length : 0
  const conditionCount = Array.isArray(rule.condition)
    ? (rule.condition as { conditions?: unknown[] }[]).reduce(
        (sum, g) => sum + (g.conditions?.length ?? 0),
        0
      )
    : 0
  const parts = [`When ${subject} ${ON_SUMMARY[rule.on] ?? rule.on}`]
  if (conditionCount > 0)
    parts.push(`${conditionCount} condition${conditionCount === 1 ? '' : 's'}`)
  parts.push(`${actionCount} action${actionCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/**
 * Record rules settings section: the rule card grid + create/edit/toggle/delete/runs
 * wiring over `api.recordRules`.
 */
export function RecordRulesSection() {
  const { list, setEnabled, destroy } = useRecordRules()
  const { data: resources } = api.resource.list.useQuery(undefined, { staleTime: 60_000 })
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<RuleRow | null>(null)
  const [runsFor, setRunsFor] = useState<RuleRow | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()

  const defLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of resources ?? []) map.set(r.entityDefinitionId, r.label)
    return map
  }, [resources])

  const rules = (list.data ?? []) as RuleRow[]

  const handleDelete = async (rule: RuleRow) => {
    const ok = await confirm({
      title: 'Delete rule?',
      description: `Remove "${rule.name}"? This action cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return
    destroy.mutate({ ruleId: rule.id })
  }

  return (
    <SettingsSection
      icon={Zap}
      title='Record rules'
      description='When a field changes or a record is created or deleted, check conditions and run actions.'
      action={
        <Button variant='outline' size='sm' onClick={() => setCreateOpen(true)}>
          <Plus />
          Add
        </Button>
      }>
      <div className='@container'>
        <div className='grid gap-2 @md:grid-cols-2 @2xl:grid-cols-3'>
          {list.isLoading &&
            [...Array(3)].map((_, i) => (
              <ListCard key={`skeleton-${i}`} loading descriptionLines={0} />
            ))}

          {!list.isLoading &&
            rules.map((rule) => {
              // Managed rules (e.g. inventory-source setup) are edit/delete-locked; only the
              // enable toggle + run history are offered, and the card opens run history.
              const managed = rule.managed != null
              const menuItems: ListCardMenuItem[] = managed
                ? [
                    { label: 'Run history', icon: <History />, onClick: () => setRunsFor(rule) },
                    {
                      label: rule.enabled ? 'Disable' : 'Enable',
                      icon: <Zap />,
                      onClick: () => setEnabled.mutate({ ruleId: rule.id, enabled: !rule.enabled }),
                    },
                  ]
                : [
                    { label: 'Edit', icon: <Pencil />, onClick: () => setEditing(rule) },
                    { label: 'Run history', icon: <History />, onClick: () => setRunsFor(rule) },
                    {
                      label: rule.enabled ? 'Disable' : 'Enable',
                      icon: <Zap />,
                      onClick: () => setEnabled.mutate({ ruleId: rule.id, enabled: !rule.enabled }),
                    },
                    {
                      label: 'Delete',
                      icon: <Trash />,
                      onClick: () => void handleDelete(rule),
                      destructive: true,
                    },
                  ]
              const badges = [
                ...(managed ? [{ label: 'Managed', icon: <Lock className='size-3' /> }] : []),
                ...(rule.enabled ? [] : [{ label: 'Disabled' }]),
              ]
              return (
                <ListCard
                  key={rule.id}
                  title={rule.name}
                  subtitle={defLabels.get(rule.entityDefinitionId) ?? 'Record'}
                  description={describeRule(rule, defLabels.get(rule.entityDefinitionId))}
                  icon={<Zap className='size-4' />}
                  headerEnd={badges.length > 0 ? renderBadgeChips(badges) : undefined}
                  onClick={() => (managed ? setRunsFor(rule) : setEditing(rule))}
                  menuItems={menuItems}
                />
              )
            })}

          {!list.isLoading && rules.length === 0 && (
            <ListCard
              title='Add a rule'
              subtitle='Record rules'
              description='React to record changes with conditions and actions.'
              icon={<Zap className='size-4 text-muted-foreground' />}
              onClick={() => setCreateOpen(true)}
            />
          )}
        </div>
      </div>

      <RecordRuleDialog
        open={createOpen || editing !== null}
        onClose={() => {
          setCreateOpen(false)
          setEditing(null)
        }}
        rule={editing}
      />
      {runsFor && <RecordRuleRunsDialog rule={runsFor} open onClose={() => setRunsFor(null)} />}
      <ConfirmDialog />
    </SettingsSection>
  )
}
