// apps/web/src/components/permissions/ui/agent-policy-areas-grid.tsx
'use client'

import type { AgentAccessLevel } from '@auxx/database'
import { AREA_ORDER, type Area, PERMISSION_AREAS } from '@auxx/lib/permissions/client'
import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { NormalizedAgentPolicy } from '../hooks/use-agent-policy'
import { followDefaultTooltip, MAIL_IS_OUTSIDE, usesDefaultLabel } from './agent-policy-copy'
import { AgentPolicyDefaultRow } from './agent-policy-level-control'
import { clampToArea, LevelControl } from './level-control'
import { agentLevelOfLevel, LEVEL_OF_AGENT_LEVEL } from './level-labels'

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

/**
 * The exact per-area grid: one explicit default plus sparse overrides, every
 * value one of `None / Read / Edit / Full`.
 *
 * The default is not cosmetic — an area added by a future deploy resolves through
 * it, which is why it is authored here rather than inferred (plan 19 §0.5).
 *
 * The area rows use the HUMAN {@link LevelControl} (plan 26 §2.3). Areas do not
 * all implement four rungs — most are on/off (a lone `Full` rung), and
 * `dispatchBoard` skips `Edit` — and that control renders `[None, ...area.rungs]`
 * and clamps the highlighted segment down to the nearest real rung. So a rung the
 * area cannot express is no longer offerable at all, which is a better answer
 * than offering it and warning that the pick is inert. The DEFAULT row above
 * keeps the full four-rung control: it stands in for areas that do not exist yet,
 * whose ladders are unknowable here.
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
        description='What an area with no rule below resolves to, including areas added in a future release.'
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
                // The collection default is one rung for EVERY area at once, so
                // on an area that doesn't implement it (most are on/off) it
                // resolves downward. Name the resolved rung, not the authored
                // one: the segment highlight is already clamped, and "Default ·
                // Read" beside a highlighted None reads as a contradiction.
                const resolvedDefault = agentLevelOfLevel(
                  clampToArea(meta, LEVEL_OF_AGENT_LEVEL[policy.areas.default])
                )
                return (
                  <TreeRow
                    key={area}
                    rowClassName='bg-primary-50 hover:bg-primary-100'
                    title={meta.label}
                    description={
                      meta.adminOnly
                        ? `${meta.description} Admin-only for people. An agent may still hold it, but a non-admin publishing this profile has it clamped to their own access.`
                        : meta.description
                    }
                    trailing={
                      <LevelControl
                        area={meta}
                        value={override === undefined ? undefined : LEVEL_OF_AGENT_LEVEL[override]}
                        inherited={LEVEL_OF_AGENT_LEVEL[policy.areas.default]}
                        // Never "ignored": agent policy is a SET, so nothing an
                        // author writes here is composed away by a baseline.
                        ignored={false}
                        unsetHint={usesDefaultLabel(resolvedDefault)}
                        resetTooltip={followDefaultTooltip(resolvedDefault)}
                        onChange={(level) =>
                          onOverrideChange(
                            area,
                            level === undefined ? undefined : agentLevelOfLevel(level)
                          )
                        }
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
