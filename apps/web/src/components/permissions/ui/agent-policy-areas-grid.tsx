// apps/web/src/components/permissions/ui/agent-policy-areas-grid.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import {
  AREA_ORDER,
  type Area,
  type AreaMetadata,
  Level,
  PERMISSION_AREAS,
} from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NormalizedAgentPolicy } from '../hooks/use-agent-policy'
import { AGENT_LEVEL_LABELS, MAIL_IS_OUTSIDE } from './agent-policy-copy'
import { AgentPolicyDefaultRow, AgentPolicyLevelControl } from './agent-policy-level-control'

/**
 * The areas the agent policy can express. `workerOnly` areas are excluded: their
 * enforcement is gated on `seatType === 'worker'`, which an agent never is, so a
 * control here would be a lever that does nothing.
 *
 * `adminOnly` areas ARE offered. That flag means "not grantable below ADMIN" on
 * the *human* baseline; an agent's authority comes from this policy and nothing
 * else, bounded at publish by the §2.4a author clamp — so the honest treatment is
 * to show the rung and name the clamp, not to hide it.
 */
const AREA_GROUPS: Array<{ group: string; areas: Area[] }> = (() => {
  const order: string[] = []
  const byGroup = new Map<string, Area[]>()
  for (const area of AREA_ORDER) {
    const meta = PERMISSION_AREAS[area]
    if (meta.workerOnly) continue
    if (!byGroup.has(meta.group)) {
      byGroup.set(meta.group, [])
      order.push(meta.group)
    }
    byGroup.get(meta.group)?.push(area)
  }
  return order.map((group) => ({ group, areas: byGroup.get(group) ?? [] }))
})()

/** Every area this grid renders — also the keyspace the clamp preview checks. */
export const AGENT_POLICY_AREAS: readonly Area[] = AREA_GROUPS.flatMap((g) => g.areas)

/** The §2.3 label→ladder mapping, area half. */
const AREA_LEVEL_OF: Record<AgentAccessLevel, Level> = {
  none: Level.None,
  read: Level.Read,
  read_write: Level.Edit,
  full: Level.Full,
}

/** Inverse of {@link AREA_LEVEL_OF}, for naming what a rung actually resolves to. */
function agentLevelOfAreaLevel(level: Level): AgentAccessLevel {
  if (level >= Level.Full) return 'full'
  if (level >= Level.Edit) return 'read_write'
  if (level >= Level.Read) return 'read'
  return 'none'
}

/**
 * Whether a rung is inert for this area, and the sentence that says so.
 *
 * Areas do not all implement four rungs — most are on/off (a lone `Full` rung),
 * and `dispatchBoard` skips `Edit`. The stored vocabulary is still four levels,
 * so rather than hide a segment (which would misrepresent a stored value) the
 * control keeps all four and warns when the chosen one collapses downward.
 */
function inertNoteFor(meta: AreaMetadata, level: AgentAccessLevel): string | undefined {
  if (level === 'none') return undefined
  const target = AREA_LEVEL_OF[level]
  let actual = Level.None
  for (const rung of meta.rungs) {
    if (rung.level <= target) actual = rung.level
  }
  if (actual === target) return undefined
  return `${meta.label} has no ${AGENT_LEVEL_LABELS[level]} rung — this behaves as ${AGENT_LEVEL_LABELS[agentLevelOfAreaLevel(actual)]}.`
}

/**
 * The exact per-area grid: one explicit default plus sparse overrides, every
 * value one of `None / Read / Read + Write / Full`.
 *
 * The default is not cosmetic — an area added by a future deploy resolves through
 * it, which is why it is authored here rather than inferred (plan 19 §0.5).
 */
export function AgentPolicyAreasGrid({
  policy,
  onDefaultChange,
  onOverrideChange,
  disabled = false,
}: {
  policy: NormalizedAgentPolicy
  onDefaultChange: (level: AgentAccessLevel) => void
  onOverrideChange: (area: string, level: AgentAccessLevel | undefined) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const [rulesOnly, setRulesOnly] = useState(false)
  const query = search.trim().toLowerCase()

  const groups = useMemo(() => {
    const result: Array<{ group: string; areas: Area[] }> = []
    for (const { group, areas } of AREA_GROUPS) {
      const rows = areas.filter((area) => {
        const meta = PERMISSION_AREAS[area]
        if (rulesOnly && policy.areas.overrides[area] === undefined) return false
        if (!query) return true
        return (
          meta.label.toLowerCase().includes(query) || meta.description.toLowerCase().includes(query)
        )
      })
      if (rows.length > 0) result.push({ group, areas: rows })
    }
    return result
  }, [query, rulesOnly, policy.areas.overrides])

  return (
    <div className='flex flex-col gap-3'>
      <AgentPolicyDefaultRow
        title='Default for every area'
        description='What an area with no rule below resolves to — including areas added in a future release.'
        value={policy.areas.default}
        onChange={onDefaultChange}
        disabled={disabled}
      />

      <div className='flex items-center gap-2'>
        <InputSearch
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search areas...'
        />
        <ButtonSwitch
          label='Rules only'
          checked={rulesOnly}
          onCheckedChange={setRulesOnly}
          disabled={disabled}
        />
      </div>

      {groups.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<SlidersHorizontal />}
          title='No matches'
          description='No access areas match your search.'
        />
      ) : (
        <div className='flex flex-col gap-4'>
          {groups.map(({ group, areas }) => (
            <div key={group} className='flex flex-col gap-0.5'>
              <span className='px-1 text-xs font-semibold uppercase text-primary-600'>{group}</span>
              {areas.map((area) => {
                const meta = PERMISSION_AREAS[area]
                const override = policy.areas.overrides[area]
                const effective = override ?? policy.areas.default
                return (
                  <TreeRow
                    key={area}
                    rowClassName='bg-primary-50 hover:bg-primary-100'
                    title={meta.label}
                    description={
                      meta.adminOnly
                        ? `${meta.description} Admin-only for people — an agent may still hold it, but a non-admin publishing this profile has it clamped to their own access.`
                        : meta.description
                    }
                    trailing={
                      <AgentPolicyLevelControl
                        label={meta.label}
                        value={override}
                        fallback={policy.areas.default}
                        inertNote={inertNoteFor(meta, effective)}
                        onChange={(level) => onOverrideChange(area, level)}
                        disabled={disabled}
                      />
                    }
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}

      <p className='px-1 text-xs text-muted-foreground'>{MAIL_IS_OUTSIDE}</p>
    </div>
  )
}
