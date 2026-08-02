// apps/web/src/components/record-rules/ui/record-rules-section.tsx

'use client'

import type { ListCardBadgeChip } from '@auxx/ui/components/list-card'
import { Lock, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { RuleListSection } from '~/components/rules/ui/rule-list-section'
import { useAccess } from '~/providers/capabilities-provider'
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
 * Record rules settings section: the shared rule card grid wired to `api.recordRules`
 * for create/edit/toggle/delete/runs.
 *
 * **Self-guarded on `automationRules.manage`** (plan §6.4). `settings/rules` used
 * to carry a whole-page `CapabilityPageGuard` on that key, but the page now also
 * hosts mail filters, which a personal-mailbox owner manages with NO key at all
 * (D14/D16). Moving the check down here keeps this section's audience exactly
 * what it was — every `api.recordRules` procedure is key-gated server-side, so
 * this is a UI affordance, not the boundary.
 */
export function RecordRulesSection() {
  const { list, setEnabled, destroy } = useRecordRules()
  const { canViewEntity, can, isLoading: isAccessLoading } = useAccess()
  const { data: resources } = api.resource.list.useQuery(undefined, { staleTime: 60_000 })
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<RuleRow | null>(null)
  const [runsFor, setRunsFor] = useState<RuleRow | null>(null)

  // `api.resource.list` bypasses the store; only surface labels for defs the
  // member can view (per-def read gate). A rule on a non-viewable def falls back
  // to the generic 'Record' subtitle rather than leaking the def name.
  const defLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of resources ?? []) {
      if (canViewEntity(r.entityDefinitionId)) map.set(r.entityDefinitionId, r.label)
    }
    return map
  }, [resources, canViewEntity])

  const rules = (list.data ?? []) as RuleRow[]

  // Hidden entirely without the key — never an empty grid, which would advertise
  // a feature the member cannot use. `isLoading` is respected so a legitimate
  // admin doesn't see the section blink out during an org switch or a refresh.
  if (isAccessLoading || !can('automationRules.manage')) return null

  return (
    <RuleListSection
      icon={Zap}
      title='Record rules'
      description='When a field changes or a record is created or deleted, check conditions and run actions.'
      createLabel='Add'
      onCreate={() => setCreateOpen(true)}
      isLoading={list.isLoading}
      rows={rules}
      subtitle={(rule) => defLabels.get(rule.entityDefinitionId) ?? 'Record'}
      describe={(rule) => describeRule(rule, defLabels.get(rule.entityDefinitionId))}
      badges={(rule): ListCardBadgeChip[] => [
        ...(rule.managed != null ? [{ label: 'Managed', icon: <Lock className='size-3' /> }] : []),
        ...(rule.enabled ? [] : [{ label: 'Disabled' }]),
      ]}
      // Managed rules (e.g. inventory-source setup) are edit/delete-locked; only the
      // enable toggle + run history are offered, and the card opens run history.
      isLocked={(rule) => rule.managed != null}
      onEdit={setEditing}
      onViewRuns={setRunsFor}
      onToggleEnabled={(rule) => setEnabled.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
      onDelete={(rule) => destroy.mutate({ ruleId: rule.id })}
      deleteConfirmTitle='Delete rule?'
      placeholder={{
        title: 'Add a rule',
        subtitle: 'Record rules',
        description: 'React to record changes with conditions and actions.',
      }}>
      <RecordRuleDialog
        open={createOpen || editing !== null}
        onClose={() => {
          setCreateOpen(false)
          setEditing(null)
        }}
        rule={editing}
      />
      {runsFor && <RecordRuleRunsDialog rule={runsFor} open onClose={() => setRunsFor(null)} />}
    </RuleListSection>
  )
}
